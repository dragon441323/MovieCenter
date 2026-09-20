import path from 'node:path'
import sharp from 'sharp'
import { db, PERSONS_DIR } from './db.js'
import * as tmdb from './tmdb.js'

function normalize(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

async function downloadAndSave(tmdbId, profilePath) {
  const buf = await tmdb.downloadImage(profilePath, 'w185')
  if (!buf || !buf.length) return ''
  const filename = `${tmdbId}.jpg`
  await sharp(buf)
    .resize({ width: 200, withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(path.join(PERSONS_DIR, filename))
  return filename
}

export async function resolvePersonPhoto(name) {
  const key = normalize(name)
  if (!key) return { name, tmdb_id: null, photo: '' }

  // 缓存命中
  const row = db.prepare('SELECT tmdb_id, photo FROM person WHERE name = ? COLLATE NOCASE').get(name)
  if (row?.photo) return { name, tmdb_id: row.tmdb_id, photo: row.photo }

  let results = []
  try {
    results = await tmdb.searchPerson(name)
  } catch {
    return { name, tmdb_id: null, photo: '' }
  }
  // 优先精确匹配名字/原名，否则取第一个结果
  const hit = results.find(r => normalize(r.name) === key || normalize(r.original_name) === key) || results[0]
  if (!hit) return { name, tmdb_id: null, photo: '' }

  let photo = ''
  if (hit.profile_path) {
    try {
      photo = await downloadAndSave(hit.id, hit.profile_path)
    } catch {}
  }
  db.prepare(`
    INSERT INTO person (tmdb_id, name, profile_path, photo) VALUES (?, ?, ?, ?)
    ON CONFLICT(tmdb_id) DO UPDATE SET
      name = excluded.name, profile_path = excluded.profile_path, photo = excluded.photo
  `).run(hit.id, hit.name || name, hit.profile_path || '', photo)
  return { name, tmdb_id: hit.id, photo }
}

// 带并发上限的批量处理
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

export async function resolvePersonPhotos(names) {
  return mapLimit(names, 5, name =>
    resolvePersonPhoto(name).catch(() => ({ name, tmdb_id: null, photo: '' }))
  )
}
