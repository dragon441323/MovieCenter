import { Router } from 'express'
import { db } from '../db.js'
import * as tmdb from '../tmdb.js'

export const collectionRouter = Router()

collectionRouter.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT collection_id, collection_name, COUNT(*) AS count, MIN(title) AS sample_title
    FROM movie
    WHERE missing = 0 AND collection_id IS NOT NULL
    GROUP BY collection_id, collection_name
    ORDER BY count DESC, collection_name COLLATE NOCASE
  `).all()
  res.json({ items: rows })
})

collectionRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '无效的 ID' })
  const local = db.prepare('SELECT * FROM movie WHERE collection_id = ? AND missing = 0 ORDER BY year').all(id)
  if (!local.length) return res.status(404).json({ error: '库中没有该合集的电影' })

  let parts = local.map(m => ({
    tmdb_id: m.tmdb_id,
    title: m.title,
    year: m.year,
    poster_url: m.cover ? `/covers/${m.cover}` : null,
    in_library: true,
    movie_id: m.id
  }))
  let name = local[0].collection_name

  try {
    const data = await tmdb.getCollection(id)
    if (data?.name) name = data.name
    if (Array.isArray(data?.parts) && data.parts.length) {
      const byTmdb = new Map(parts.map(p => [p.tmdb_id, p]))
      const merged = data.parts.map(p => {
        const existing = byTmdb.get(p.id)
        if (existing) return existing
        return {
          tmdb_id: p.id,
          title: p.title || p.original_title || '',
          year: p.release_date ? Number(p.release_date.slice(0, 4)) : null,
          poster_url: null,
          in_library: false,
          movie_id: null
        }
      })
      for (const p of merged) {
        if (!p.poster_url && !p.in_library) {
          const localMatch = db.prepare('SELECT id, cover FROM movie WHERE tmdb_id = ? AND missing = 0').get(p.tmdb_id)
          if (localMatch) {
            p.in_library = true
            p.movie_id = localMatch.id
            if (localMatch.cover) p.poster_url = `/covers/${localMatch.cover}`
          }
        }
      }
      parts = merged
    }
  } catch {}

  res.json({ collection_id: id, name, parts })
})
