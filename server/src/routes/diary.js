import { Router } from 'express'
import { db } from '../db.js'
import { diaryEntries, yearReport } from '../diary.js'

export const diaryRouter = Router()

// 时间线（支持 year 过滤与分页）
diaryRouter.get('/', (req, res) => {
  const { year, page, page_size } = req.query
  res.json(diaryEntries({ year, page, page_size }))
})

// 年度报告
diaryRouter.get('/report', (req, res) => {
  let year = Number(req.query.year)
  if (!Number.isInteger(year)) year = new Date().getFullYear()
  res.json(yearReport(year))
})

// 修改日记条目的备注
diaryRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '无效的 ID' })
  const row = db.prepare('SELECT * FROM watch_log WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ error: '记录不存在' })
  const note = String(req.body?.note ?? '').trim()
  db.prepare('UPDATE watch_log SET note = ? WHERE id = ?').run(note, id)
  res.json({ ...row, note })
})

// 删除日记条目
diaryRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '无效的 ID' })
  const r = db.prepare('DELETE FROM watch_log WHERE id = ?').run(id)
  if (!r.changes) return res.status(404).json({ error: '记录不存在' })
  res.json({ ok: true })
})
