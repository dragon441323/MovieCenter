import { Router } from 'express'
import { resolvePersonPhotos } from '../person.js'

export const personRouter = Router()

const MAX_NAMES = 100

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
