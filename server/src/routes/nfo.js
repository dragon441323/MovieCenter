import { Router } from 'express'
import { db } from '../db.js'
import { writeNfoForMovie, writeNfoAll, previewNfo } from '../nfo.js'

export const nfoRouter = Router()

function parseId(raw) {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

// 单片导出（写盘）
nfoRouter.post('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的 ID' })
  try {
    const r = await writeNfoForMovie(id)
    res.json({ ok: true, ...r })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

// 预览 NFO 内容
nfoRouter.get('/:id/preview', (req, res) => {
  const id = parseId(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的 ID' })
  try {
    const content = previewNfo(id)
    const movie = db.prepare('SELECT title FROM movie WHERE id = ?').get(id)
    res.json({ title: movie?.title, content })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

// 批量导出
nfoRouter.post('/', async (req, res) => {
  try {
    const r = await writeNfoAll()
    res.json(r)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
