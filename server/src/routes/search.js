import { Router } from 'express'
import { db } from '../db.js'
import { serializeMovie } from './movies.js'

export const searchRouter = Router()

function escapeLike(s) {
  return s.replace(/[\\%_]/g, m => '\\' + m)
}

/**
 * 全局搜索：一个关键词同时查电影 / 人物(导演+演员) / 标签 / 片单 / 想看。
 * GET /api/search?q=xxx&limit=8
 * 返回分组结果，每组最多 limit 条，供顶栏搜索框下拉展示。
 */
searchRouter.get('/', (req, res) => {
  const q = String(req.query.q || '').trim()
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 8))
  if (!q) return res.json({ q: '', movies: [], people: [], tags: [], playlists: [], wishlist: [] })

  const like = `%${escapeLike(q)}%`
  const likeLower = `%${escapeLike(q.toLowerCase())}%`

  // 电影：标题/原名/拼音(search_text 覆盖)
  const movieRows = db.prepare(`
    SELECT * FROM movie
    WHERE missing = 0 AND (
      title LIKE ? ESCAPE '\\' OR original_title LIKE ? ESCAPE '\\'
      OR search_text LIKE ? ESCAPE '\\'
    )
    ORDER BY COALESCE(douban_rating, rating, 0) DESC
    LIMIT ?
  `).all(like, like, likeLower, limit)
  const movies = movieRows.map(r => {
    const m = serializeMovie(r)
    return {
      id: m.id,
      title: m.title,
      original_title: m.original_title,
      year: m.year,
      cover_url: m.cover_url,
      rating: m.douban_rating ?? m.rating ?? null,
      categories: (m.categories || []).slice(0, 2),
      watched: !!m.watched
    }
  })

  // 人物：从电影表聚合导演/演员（精确名匹配优先，其次包含）
  const people = []
  const seen = new Set()
  const pushPerson = (name, role, count) => {
    const key = name.toLowerCase()
    if (seen.has(key)) {
      const ex = people.find(p => p.name.toLowerCase() === key)
      if (ex && role === 'director' && !ex.is_director) ex.is_director = true
      return
    }
    seen.add(key)
    people.push({ name, role, is_director: role === 'director', count })
  }
  const dirRows = db.prepare(`
    SELECT director, COUNT(*) AS c FROM movie
    WHERE missing = 0 AND director LIKE ? ESCAPE '\\'
    LIMIT 200
  `).all(like)
  for (const r of dirRows) {
    for (const n of String(r.director).split(/[/、,，;；|]/).map(s => s.trim()).filter(Boolean)) {
      if (n.toLowerCase().includes(q.toLowerCase())) pushPerson(n, 'director', null)
    }
  }
  const actRows = db.prepare(`
    SELECT actors FROM movie
    WHERE missing = 0 AND actors LIKE ? ESCAPE '\\'
    LIMIT 400
  `).all(`%"${escapeLike(q)}"%`)
  for (const r of actRows) {
    try {
      for (const n of JSON.parse(r.actors || '[]')) {
        if (typeof n === 'string' && n.toLowerCase().includes(q.toLowerCase())) pushPerson(n.trim(), 'actor', null)
      }
    } catch {}
  }
  // 出现次数统计（演员）
  const countMap = new Map()
  for (const r of db.prepare("SELECT actors FROM movie WHERE missing = 0 AND actors != ''").all()) {
    try {
      for (const n of JSON.parse(r.actors || '[]')) {
        if (typeof n === 'string' && n.toLowerCase().includes(q.toLowerCase())) {
          countMap.set(n.trim(), (countMap.get(n.trim()) || 0) + 1)
        }
      }
    } catch {}
  }
  for (const p of people) if (p.role === 'actor') p.count = countMap.get(p.name) || 1
  people.splice(limit)

  // 标签
  const tags = db.prepare(`
    SELECT t.id, t.name, COUNT(mt.movie_id) AS movie_count
    FROM tag t LEFT JOIN movie_tag mt ON mt.tag_id = t.id
    WHERE t.name LIKE ? ESCAPE '\\'
    GROUP BY t.id, t.name
    ORDER BY movie_count DESC
    LIMIT ?
  `).all(like, limit)

  // 片单
  const playlists = db.prepare(`
    SELECT p.id, p.name, p.description, COUNT(pm.movie_id) AS movie_count
    FROM playlist p LEFT JOIN playlist_movie pm ON pm.playlist_id = p.id
    WHERE p.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\'
    GROUP BY p.id, p.name
    ORDER BY p.updated_at DESC
    LIMIT ?
  `).all(like, like, limit)

  // 想看清单（未入库的）
  const wishlist = db.prepare(`
    SELECT id, title, year, poster FROM wishlist
    WHERE status = 'wanted' AND (title LIKE ? ESCAPE '\\' OR original_title LIKE ? ESCAPE '\\')
    LIMIT ?
  `).all(like, like, limit)

  res.json({
    q,
    movies,
    people: people.map(p => ({ name: p.name, is_director: p.is_director, count: p.count })),
    tags,
    playlists,
    wishlist: wishlist.map(w => ({
      id: w.id,
      title: w.title,
      year: w.year,
      poster_url: w.poster
        ? (/^https?:\/\//i.test(w.poster)
          ? `/api/wishlist/poster?url=${encodeURIComponent(w.poster)}`
          : `/covers/${w.poster}`)
        : null
    }))
  })
})
