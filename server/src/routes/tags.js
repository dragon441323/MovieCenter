import { Router } from 'express'
import { db } from '../db.js'

export const tagRouter = Router()

tagRouter.get('/', (req, res) => {
  res.json(db.prepare(`
    SELECT t.id, t.name, COUNT(mt.movie_id) AS movie_count
    FROM tag t LEFT JOIN movie_tag mt ON mt.tag_id = t.id
    GROUP BY t.id, t.name
    ORDER BY t.name COLLATE NOCASE
  `).all())
})

tagRouter.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: '标签名不能为空' })
  if (db.prepare('SELECT id FROM tag WHERE name = ? COLLATE NOCASE').get(name)) {
    return res.status(409).json({ error: '标签已存在' })
  }
  const r = db.prepare('INSERT INTO tag (name) VALUES (?)').run(name)
  res.status(201).json({ id: Number(r.lastInsertRowid), name })
})

tagRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '无效的 ID' })
  const r = db.prepare('DELETE FROM tag WHERE id = ?').run(id)
  if (!r.changes) return res.status(404).json({ error: '标签不存在' })
  res.json({ ok: true })
})
