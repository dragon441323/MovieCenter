import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { db } from '../db.js'
import { scanAll, getScanState, addDefaultMoviePaths } from '../scanner.js'

export const scanRouter = Router()

scanRouter.get('/paths', (req, res) => {
  res.json(db.prepare('SELECT * FROM scan_path ORDER BY id').all())
})

scanRouter.post('/paths', (req, res) => {
  const raw = String(req.body?.path || '').trim()
  if (!raw) return res.status(400).json({ error: '缺少 path 参数' })
  const p = path.resolve(raw)
  let st
  try {
    st = fs.statSync(p)
  } catch {
    return res.status(400).json({ error: `路径不存在: ${raw}` })
  }
  if (!st.isDirectory()) return res.status(400).json({ error: '路径不是目录' })
  try {
    const r = db.prepare('INSERT INTO scan_path (path) VALUES (?)').run(p)
    res.status(201).json({ id: Number(r.lastInsertRowid), path: p, enabled: 1 })
  } catch {
    res.status(409).json({ error: '该路径已存在' })
  }
})

scanRouter.delete('/paths/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '无效的 ID' })
  const r = db.prepare('DELETE FROM scan_path WHERE id = ?').run(id)
  if (!r.changes) return res.status(404).json({ error: '路径不存在' })
  res.json({ ok: true })
})

scanRouter.post('/detect', async (req, res) => {
  res.json(await addDefaultMoviePaths())
})

scanRouter.post('/', (req, res) => {
  if (getScanState().scanning) {
    return res.status(409).json({ error: '扫描正在进行中' })
  }
  scanAll().catch(err => console.error('[scan] error:', err.message))
  res.json({ started: true })
})

scanRouter.delete('/missing', (req, res) => {
  const r = db.prepare('DELETE FROM movie WHERE missing = 1').run()
  res.json({ removed: Number(r.changes) })
})

scanRouter.get('/status', (req, res) => {
  res.json(getScanState())
})
