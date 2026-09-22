import { Router } from 'express'
import { db } from '../db.js'
import { serializeMovie, attachTags } from './movies.js'

export const playlistRouter = Router()

function parseId(raw) {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

function touch(playlistId) {
  db.prepare("UPDATE playlist SET updated_at = datetime('now') WHERE id = ?").run(playlistId)
}

/** 片单列表（含影片数与拼图封面：取前 4 部的封面） */
playlistRouter.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, COUNT(pm.movie_id) AS movie_count
    FROM playlist p LEFT JOIN playlist_movie pm ON pm.playlist_id = p.id
    GROUP BY p.id
    ORDER BY p.updated_at DESC
  `).all()
  const coverStmt = db.prepare(`
    SELECT m.cover FROM playlist_movie pm
    JOIN movie m ON m.id = pm.movie_id AND m.cover != ''
    WHERE pm.playlist_id = ?
    ORDER BY pm.sort, pm.added_at DESC
    LIMIT 4
  `)
  res.json({
    items: rows.map(p => {
      const covers = coverStmt.all(p.id).map(r => r.cover)
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        movie_count: p.movie_count,
        covers: covers.map(c => `/covers/${c}`),
        created_at: p.created_at,
        updated_at: p.updated_at
      }
    })
  })
})

/** 单个片单详情（含影片列表，按 sort 排序） */
playlistRouter.get('/:id', (req, res) => {
  const id = parseId(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的 ID' })
  const p = db.prepare('SELECT * FROM playlist WHERE id = ?').get(id)
  if (!p) return res.status(404).json({ error: '片单不存在' })
  const rows = db.prepare(`
    SELECT m.* FROM playlist_movie pm
    JOIN movie m ON m.id = pm.movie_id
    WHERE pm.playlist_id = ?
    ORDER BY pm.sort, pm.added_at DESC
  `).all(id)
  res.json({
    playlist: {
      id: p.id,
      name: p.name,
      description: p.description,
      movie_count: rows.length,
      created_at: p.created_at,
      updated_at: p.updated_at
    },
    movies: attachTags(rows)
  })
})

/** 创建片单 */
playlistRouter.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: '片单名称不能为空' })
  if (name.length > 50) return res.status(400).json({ error: '名称过长（最多 50 字）' })
  const description = String(req.body?.description || '').trim().slice(0, 200)
  try {
    const r = db.prepare('INSERT INTO playlist (name, description) VALUES (?, ?)').run(name, description)
    res.status(201).json({ id: Number(r.lastInsertRowid), name, description, movie_count: 0 })
  } catch {
    res.status(409).json({ error: '已有同名片单' })
  }
})

/** 修改片单信息 */
playlistRouter.put('/:id', (req, res) => {
  const id = parseId(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的 ID' })
  const p = db.prepare('SELECT * FROM playlist WHERE id = ?').get(id)
  if (!p) return res.status(404).json({ error: '片单不存在' })
  const b = req.body || {}
  const name = 'name' in b ? String(b.name || '').trim() : p.name
  if (!name) return res.status(400).json({ error: '片单名称不能为空' })
  const description = 'description' in b ? String(b.description || '').trim().slice(0, 200) : p.description
  try {
    db.prepare("UPDATE playlist SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?").run(name, description, id)
    res.json({ id, name, description })
  } catch {
    res.status(409).json({ error: '已有同名片单' })
  }
})

/** 删除片单（关联关系级联删除） */
playlistRouter.delete('/:id', (req, res) => {
  const id = parseId(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的 ID' })
  const r = db.prepare('DELETE FROM playlist WHERE id = ?').run(id)
  if (!r.changes) return res.status(404).json({ error: '片单不存在' })
  res.json({ ok: true })
})

/** 加入影片（可选 sort 插入到末尾） */
playlistRouter.post('/:id/movies', (req, res) => {
  const id = parseId(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的 ID' })
  if (!db.prepare('SELECT id FROM playlist WHERE id = ?').get(id)) {
    return res.status(404).json({ error: '片单不存在' })
  }
  const movieId = Number(req.body?.movie_id)
  if (!Number.isInteger(movieId) || movieId <= 0) return res.status(400).json({ error: '无效的 movie_id' })
  if (!db.prepare('SELECT id FROM movie WHERE id = ?').get(movieId)) {
    return res.status(404).json({ error: '电影不存在' })
  }
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM playlist_movie WHERE playlist_id = ?').get(id).s
  const r = db.prepare('INSERT OR IGNORE INTO playlist_movie (playlist_id, movie_id, sort) VALUES (?, ?, ?)').run(id, movieId, maxSort + 1)
  if (!r.changes) return res.status(409).json({ error: '该影片已在片单中' })
  touch(id)
  const count = db.prepare('SELECT COUNT(*) AS c FROM playlist_movie WHERE playlist_id = ?').get(id).c
  res.status(201).json({ ok: true, movie_count: count })
})

/** 移出影片 */
playlistRouter.delete('/:id/movies/:movieId', (req, res) => {
  const id = parseId(req.params.id)
  const movieId = parseId(req.params.movieId)
  if (!id || !movieId) return res.status(400).json({ error: '无效的 ID' })
  const r = db.prepare('DELETE FROM playlist_movie WHERE playlist_id = ? AND movie_id = ?').run(id, movieId)
  if (!r.changes) return res.status(404).json({ error: '影片不在此片单中' })
  touch(id)
  res.json({ ok: true })
})

/** 整体重排序（前端拖拽后提交 movie_id 数组） */
playlistRouter.put('/:id/order', (req, res) => {
  const id = parseId(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的 ID' })
  if (!db.prepare('SELECT id FROM playlist WHERE id = ?').get(id)) {
    return res.status(404).json({ error: '片单不存在' })
  }
  const ids = req.body?.movie_ids
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: '缺少 movie_ids' })
  try {
    db.exec('BEGIN')
    const upd = db.prepare('UPDATE playlist_movie SET sort = ? WHERE playlist_id = ? AND movie_id = ?')
    ids.forEach((mid, i) => upd.run(i + 1, id, Number(mid)))
    db.exec('COMMIT')
    touch(id)
    res.json({ ok: true })
  } catch (err) {
    db.exec('ROLLBACK')
    res.status(500).json({ error: err.message })
  }
})
