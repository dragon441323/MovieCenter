import { Router } from 'express'
import multer from 'multer'
import { db } from '../db.js'
import { saveCoverBuffer, removeCoverFile } from '../covers.js'

export const movieRouter = Router()

const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(null, true)
    const err = new Error('仅支持 JPG/PNG/WebP 图片')
    err.status = 400
    cb(err)
  }
})

const SORTS = {
  title: 'title COLLATE NOCASE',
  year: 'year',
  rating: 'rating',
  my_rating: 'my_rating',
  file_size: 'file_size',
  created_at: 'created_at',
  updated_at: 'updated_at'
}

export function parseCategories(value) {
  if (!value) return []
  try {
    const arr = JSON.parse(value)
    if (Array.isArray(arr)) return arr.map(c => String(c).trim()).filter(Boolean)
  } catch {}
  return String(value).split('/').map(c => c.trim()).filter(Boolean)
}

function escapeLike(s) {
  return s.replace(/[\\%_]/g, m => '\\' + m)
}

function parseActors(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map(v => String(v).trim()).filter(Boolean)
    } catch {}
    return value.split(/[,，、;；]/).map(v => v.trim()).filter(Boolean)
  }
  return []
}

export function serializeMovie(row) {
  let actors = []
  try { actors = JSON.parse(row.actors || '[]') } catch {}
  return { ...row, actors, categories: parseCategories(row.category), cover_url: row.cover ? `/covers/${row.cover}` : null }
}

export function attachTags(rows) {
  if (!rows.length) return rows.map(serializeMovie)
  const placeholders = rows.map(() => '?').join(',')
  const tagRows = db.prepare(
    `SELECT mt.movie_id, t.id, t.name FROM movie_tag mt JOIN tag t ON t.id = mt.tag_id WHERE mt.movie_id IN (${placeholders})`
  ).all(...rows.map(r => r.id))
  const byMovie = new Map()
  for (const t of tagRows) {
    if (!byMovie.has(t.movie_id)) byMovie.set(t.movie_id, [])
    byMovie.get(t.movie_id).push({ id: t.id, name: t.name })
  }
  return rows.map(r => ({ ...serializeMovie(r), tags: byMovie.get(r.id) || [] }))
}

function syncTags(movieId, names) {
  const wanted = [...new Set(names.map(n => String(n).trim()).filter(Boolean))]
  const current = db.prepare(
    'SELECT t.id, t.name FROM movie_tag mt JOIN tag t ON t.id = mt.tag_id WHERE mt.movie_id = ?'
  ).all(movieId)
  const currentByName = new Map(current.map(c => [c.name.toLowerCase(), c.id]))
  const finalIds = new Set()
  for (const name of wanted) {
    const key = name.toLowerCase()
    if (currentByName.has(key)) {
      finalIds.add(currentByName.get(key))
      continue
    }
    let tag = db.prepare('SELECT id FROM tag WHERE name = ? COLLATE NOCASE').get(name)
    if (!tag) tag = { id: Number(db.prepare('INSERT INTO tag (name) VALUES (?)').run(name).lastInsertRowid) }
    finalIds.add(tag.id)
  }
  db.prepare('DELETE FROM movie_tag WHERE movie_id = ?').run(movieId)
  const insert = db.prepare('INSERT OR IGNORE INTO movie_tag (movie_id, tag_id) VALUES (?, ?)')
  for (const tagId of finalIds) insert.run(movieId, tagId)
}

function parseId(raw) {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

movieRouter.get('/', (req, res) => {
  const q = req.query
  const where = []
  const params = []

  if (q.missing === 'true' || q.missing === '1') where.push('missing = 1')
  else if (q.missing !== 'all') where.push('missing = 0')

  if (q.q) {
    const like = `%${escapeLike(String(q.q))}%`
    where.push("(title LIKE ? ESCAPE '\\' OR director LIKE ? ESCAPE '\\' OR actors LIKE ? ESCAPE '\\' OR synopsis LIKE ? ESCAPE '\\')")
    params.push(like, like, like, like)
  }
  if (q.category) {
    const val = String(q.category).replace(/"/g, '').trim()
    if (val) {
      where.push('category LIKE ?')
      params.push(`%"${escapeLike(val)}"%`)
    }
  }
  if (q.year) {
    const year = Number(q.year)
    if (Number.isInteger(year)) {
      where.push('year = ?')
      params.push(year)
    }
  }
  if (q.favorite === 'true' || q.favorite === '1') where.push('favorite = 1')
  if (q.watched === 'true' || q.watched === '1') where.push('watched = 1')
  else if (q.watched === 'false' || q.watched === '0') where.push('watched = 0')
  if (q.my_min !== undefined && q.my_min !== '') {
    const v = Number(q.my_min)
    if (Number.isFinite(v)) {
      where.push('my_rating >= ?')
      params.push(v)
    }
  }
  if (q.my_max !== undefined && q.my_max !== '') {
    const v = Number(q.my_max)
    if (Number.isFinite(v)) {
      where.push('my_rating <= ?')
      params.push(v)
    }
  }
  if (q.unrated === 'true' || q.unrated === '1') where.push('my_rating IS NULL')

  const tagNames = String(q.tags || q.tag || '').split(',').map(s => s.trim()).filter(Boolean)
  if (tagNames.length) {
    where.push(`id IN (SELECT mt.movie_id FROM movie_tag mt JOIN tag t ON t.id = mt.tag_id WHERE t.name COLLATE NOCASE IN (${tagNames.map(() => '?').join(',')}))`)
    params.push(...tagNames)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) AS c FROM movie ${whereSql}`).get(...params).c

  const sort = SORTS[q.sort] ? q.sort : 'created_at'
  const dir = q.order === 'asc' ? 'ASC' : q.order === 'desc' ? 'DESC' : (sort === 'title' ? 'ASC' : 'DESC')
  const page = Math.max(1, parseInt(q.page) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(q.page_size) || 50))
  const offset = (page - 1) * pageSize

  const rows = db.prepare(
    `SELECT * FROM movie ${whereSql} ORDER BY ${SORTS[sort]} ${dir} LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset)

  res.json({ total, page, page_size: pageSize, items: attachTags(rows) })
})

movieRouter.get('/:id', (req, res) => {
  const id = parseId(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的 ID' })
  const row = db.prepare('SELECT * FROM movie WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ error: '电影不存在' })
  res.json(attachTags([row])[0])
})

movieRouter.put('/:id', (req, res) => {
  const id = parseId(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的 ID' })
  if (!db.prepare('SELECT id FROM movie WHERE id = ?').get(id)) {
    return res.status(404).json({ error: '电影不存在' })
  }

  const b = req.body || {}
  const sets = []
  const params = []

  if ('title' in b) {
    const title = String(b.title || '').trim()
    if (!title) return res.status(400).json({ error: '标题不能为空' })
    sets.push('title = ?')
    params.push(title)
  }
  if ('year' in b) {
    if (b.year === null || b.year === '') {
      sets.push('year = ?')
      params.push(null)
    } else {
      const year = Number(b.year)
      if (!Number.isInteger(year) || year < 1888 || year > 2100) {
        return res.status(400).json({ error: '年份无效' })
      }
      sets.push('year = ?')
      params.push(year)
    }
  }
  if ('synopsis' in b) {
    sets.push('synopsis = ?')
    params.push(String(b.synopsis ?? ''))
  }
  if ('director' in b) {
    sets.push('director = ?')
    params.push(String(b.director ?? '').trim())
  }
  if ('actors' in b) {
    sets.push('actors = ?')
    params.push(JSON.stringify(parseActors(b.actors)))
  }
  if ('category' in b || 'categories' in b) {
    const raw = 'categories' in b
      ? (Array.isArray(b.categories) ? b.categories.map(String) : String(b.categories || '').split('/'))
      : [String(b.category ?? '')]
    const cats = [...new Set(raw.map(c => c.trim()).filter(Boolean))]
    sets.push('category = ?')
    params.push(JSON.stringify(cats))
  }
  if ('rating' in b) {
    if (b.rating === null || b.rating === '') {
      sets.push('rating = ?')
      params.push(null)
    } else {
      const rating = Number(b.rating)
      if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
        return res.status(400).json({ error: '评分需在 0-10 之间' })
      }
      sets.push('rating = ?')
      params.push(rating)
    }
  }
  if ('my_rating' in b) {
    if (b.my_rating === null || b.my_rating === '') {
      sets.push('my_rating = ?')
      params.push(null)
    } else {
      const myRating = Number(b.my_rating)
      if (!Number.isFinite(myRating) || myRating < 0 || myRating > 10) {
        return res.status(400).json({ error: '我的评分需在 0-10 之间' })
      }
      sets.push('my_rating = ?')
      params.push(myRating)
    }
  }
  if ('favorite' in b) {
    sets.push('favorite = ?')
    params.push(b.favorite ? 1 : 0)
  }
  if ('watched' in b) {
    sets.push('watched = ?')
    params.push(b.watched ? 1 : 0)
  }
  if ('watch_count' in b) {
    const wc = Number(b.watch_count)
    if (!Number.isInteger(wc) || wc < 0 || wc > 99999) {
      return res.status(400).json({ error: '观看次数无效' })
    }
    sets.push('watch_count = ?')
    params.push(wc)
  }

  try {
    db.exec('BEGIN IMMEDIATE')
    if (sets.length) {
      sets.push("updated_at = datetime('now')")
      db.prepare(`UPDATE movie SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
    }
    if (Array.isArray(b.tags)) syncTags(id, b.tags)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  const updated = db.prepare('SELECT * FROM movie WHERE id = ?').get(id)
  res.json(attachTags([updated])[0])
})

movieRouter.post('/:id/cover', coverUpload.single('file'), async (req, res) => {
  const id = parseId(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的 ID' })
  const row = db.prepare('SELECT * FROM movie WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ error: '电影不存在' })
  if (!req.file) return res.status(400).json({ error: '缺少文件' })

  let filename
  try {
    filename = await saveCoverBuffer(id, req.file.buffer)
  } catch {
    return res.status(400).json({ error: '图片处理失败，请更换图片' })
  }
  removeCoverFile(row.cover)
  db.prepare("UPDATE movie SET cover = ?, updated_at = datetime('now') WHERE id = ?").run(filename, id)
  const updated = db.prepare('SELECT * FROM movie WHERE id = ?').get(id)
  res.json(attachTags([updated])[0])
})

movieRouter.delete('/:id/cover', (req, res) => {
  const id = parseId(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的 ID' })
  const row = db.prepare('SELECT * FROM movie WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ error: '电影不存在' })
  removeCoverFile(row.cover)
  db.prepare("UPDATE movie SET cover = '', updated_at = datetime('now') WHERE id = ?").run(id)
  const updated = db.prepare('SELECT * FROM movie WHERE id = ?').get(id)
  res.json(attachTags([updated])[0])
})

movieRouter.post('/:id/watch', (req, res) => {
  const id = parseId(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的 ID' })
  if (!db.prepare('SELECT id FROM movie WHERE id = ?').get(id)) {
    return res.status(404).json({ error: '电影不存在' })
  }
  db.prepare("UPDATE movie SET watch_count = watch_count + 1, watched = 1, updated_at = datetime('now') WHERE id = ?").run(id)
  const updated = db.prepare('SELECT * FROM movie WHERE id = ?').get(id)
  res.json(attachTags([updated])[0])
})
