import { Router } from 'express'
import { db } from '../db.js'
import { resolvePersonPhotos, ensureLargePhoto } from '../person.js'
import * as tmdb from '../tmdb.js'
import { attachTags } from './movies.js'

export const personRouter = Router()

const MAX_NAMES = 100
const CACHE_DAYS = 7
const MAX_CREDITS = 300

const KNOWN_FOR_ZH = {
  Directing: '导演',
  Acting: '出演',
  Writing: '编剧',
  Production: '制片',
  Sound: '声音',
  Camera: '摄影',
  Editing: '剪辑',
  Art: '美术',
  Creator: '主创',
  'Costume & Make-Up': '服装造型',
  'Visual Effects': '视效',
  Lighting: '灯光'
}

// 影史里保留的幕后岗位（避免杂项淹没作品列表）
const CREW_JOBS = new Set([
  'Director', 'Screenplay', 'Writer', 'Story', 'Producer', 'Executive Producer',
  'Editor', 'Cinematography', 'Original Music Composer', 'Production Design'
])

function escapeLike(s) {
  return s.replace(/[\\%_]/g, m => '\\' + m)
}

function isFresh(at) {
  if (!at) return false
  return Date.now() - Date.parse(at.replace(' ', 'T') + 'Z') < CACHE_DAYS * 86400000
}

function parseCredits(json) {
  try {
    const arr = JSON.parse(json)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function buildCredits(raw, libraryByTmdb) {
  const seen = new Map()
  const push = (c, type, role) => {
    if (!c || !c.id || seen.has(c.id)) {
      if (c?.id && seen.has(c.id) && role && !seen.get(c.id).roles.includes(role)) {
        seen.get(c.id).roles.push(role)
      }
      return
    }
    const year = c.release_date ? Number(c.release_date.slice(0, 4)) : null
    const lib = libraryByTmdb.get(c.id)
    seen.set(c.id, {
      tmdb_id: c.id,
      title: c.title || c.original_title || '',
      year,
      roles: [role].filter(Boolean),
      type,
      poster: c.poster_path ? tmdb.imageUrl(c.poster_path, 'w185') : '',
      vote_average: c.vote_average ?? null,
      in_library: Boolean(lib),
      movie_id: lib?.id ?? null
    })
  }
  for (const c of raw.crew || []) {
    if (CREW_JOBS.has(c.job)) push(c, 'crew', c.job)
  }
  for (const c of raw.cast || []) {
    push(c, 'cast', c.character ? `饰 ${c.character}` : '')
  }
  const list = [...seen.values()]
  list.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
  return list.slice(0, MAX_CREDITS)
}

function crewRoleZh(job) {
  return ({ Director: '导演', Screenplay: '编剧', Writer: '编剧', Story: '编剧', Producer: '制片', 'Executive Producer': '监制', Editor: '剪辑', Cinematography: '摄影', 'Original Music Composer': '配乐', 'Production Design': '美术' })[job] || job
}

personRouter.post('/photos', async (req, res) => {
  const raw = req.body?.names
  const names = Array.isArray(raw) ? raw.map(n => String(n).trim()).filter(Boolean) : []
  if (!names.length) return res.status(400).json({ error: '缺少 names 参数' })
  const items = await resolvePersonPhotos(names.slice(0, MAX_NAMES))
  res.json({
    items: items.map(p => ({
      name: p.name,
      tmdb_id: p.tmdb_id,
      photo_url: p.photo ? `/persons/${p.photo}` : null
    }))
  })
})

personRouter.get('/detail', async (req, res) => {
  const name = String(req.query.name || '').trim()
  const tmdbIdParam = Number(req.query.tmdb_id) || null
  if (!name && !tmdbIdParam) return res.status(400).json({ error: '缺少 name 或 tmdb_id 参数' })

  // 1. 本地缓存的人物记录
  let row = null
  if (tmdbIdParam) {
    row = db.prepare('SELECT * FROM person WHERE tmdb_id = ?').get(tmdbIdParam)
  }
  if (!row && name) {
    row = db.prepare('SELECT * FROM person WHERE name = ? COLLATE NOCASE').get(name)
  }
  let tmdbId = row?.tmdb_id || tmdbIdParam
  const displayName = row?.name || name

  // 2. 没有 tmdb_id 时尝试搜索（尽力而为，失败不阻塞）
  if (!tmdbId && name) {
    try {
      const results = await tmdb.searchPerson(name)
      const key = name.toLowerCase()
      const hit = results.find(r => (r.name || '').toLowerCase() === key || (r.original_name || '').toLowerCase() === key) || results[0]
      if (hit) tmdbId = hit.id
    } catch {}
  }

  // 3. 放映厅内的作品
  let directed = []
  let acted = []
  if (name) {
    const enc = escapeLike(name.replace(/"/g, ''))
    const rows = db.prepare(
      "SELECT * FROM movie WHERE missing = 0 AND (director LIKE ? ESCAPE '\\' OR actors LIKE ? ESCAPE '\\')"
    ).all(`%${enc}%`, `%"${enc}"%`)
    const movies = attachTags(rows)
    directed = movies.filter(m => String(m.director || '').includes(name))
    acted = movies.filter(m => m.actors.some(a => a === name))
  }

  // 4. TMDB 详情 + 影史（缓存 7 天）
  let details = null
  let credits = []
  let hasTmdb = false
  if (tmdbId) {
    const cached = row ? {
      biography: row.biography,
      birthday: row.birthday,
      place_of_birth: row.place_of_birth,
      known_for: row.known_for,
      credits: parseCredits(row.credits_json),
      profile_path: row.profile_path
    } : null

    if (cached && isFresh(row?.detail_at) && cached.credits.length) {
      details = cached
      credits = cached.credits
      hasTmdb = true
    } else {
      try {
        const [d, c] = await Promise.all([
          tmdb.getPersonDetails(tmdbId),
          tmdb.getPersonCredits(tmdbId)
        ])
        let bio = d.biography || ''
        if (!bio.trim()) {
          try {
            const dEn = await tmdb.getPersonDetails(tmdbId, { noLanguage: true })
            bio = dEn.biography || ''
          } catch {}
        }
        details = {
          biography: bio,
          birthday: d.birthday || '',
          place_of_birth: d.place_of_birth || '',
          known_for: KNOWN_FOR_ZH[d.known_for_department] || d.known_for_department || '',
          profile_path: d.profile_path || '',
          credits: []
        }
        const libraryByTmdb = new Map()
        for (const m of db.prepare('SELECT id, tmdb_id FROM movie WHERE missing = 0 AND tmdb_id IS NOT NULL').all()) {
          libraryByTmdb.set(m.tmdb_id, m)
        }
        credits = buildCredits(c, libraryByTmdb)
        hasTmdb = true
        db.prepare(`
          INSERT INTO person (tmdb_id, name, profile_path, biography, birthday, place_of_birth, known_for, credits_json, detail_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(tmdb_id) DO UPDATE SET
            profile_path = excluded.profile_path,
            biography = excluded.biography,
            birthday = excluded.birthday,
            place_of_birth = excluded.place_of_birth,
            known_for = excluded.known_for,
            credits_json = excluded.credits_json,
            detail_at = excluded.detail_at,
            updated_at = excluded.updated_at
        `).run(tmdbId, displayName || '', details.profile_path, details.biography, details.birthday, details.place_of_birth, details.known_for, JSON.stringify(credits))
      } catch (err) {
        // 拉取失败时回退到旧缓存（若有）
        if (cached && cached.credits.length) {
          details = cached
          credits = cached.credits
          hasTmdb = true
        }
      }
    }
  }

  // 5. 头像：本地大图 > 本地小图 > 现场下载
  let photoUrl = null
  if (row?.photo) photoUrl = `/persons/${row.photo}`
  if (tmdbId) {
    const large = await ensureLargePhoto(tmdbId, details?.profile_path || row?.profile_path || '')
    if (large) photoUrl = `/persons/${large}`
  }

  const crewZh = credits.map(c => ({
    ...c,
    roles: c.roles.map(crewRoleZh)
  }))

  res.json({
    person: {
      name: displayName,
      tmdb_id: tmdbId,
      photo_url: photoUrl,
      biography: details?.biography || '',
      birthday: details?.birthday || '',
      place_of_birth: details?.place_of_birth || '',
      known_for: details?.known_for || '',
      has_tmdb: hasTmdb
    },
    library: {
      directed,
      acted,
      count: directed.length + acted.length
    },
    credits: crewZh
  })
})
