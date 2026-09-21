import { Router } from 'express'
import { db } from '../db.js'
import { parseCategories } from './movies.js'

export const metaRouter = Router()

function movieCountries(row) {
  return parseCategories(row.country)
}

metaRouter.get('/directors', (req, res) => {
  const map = new Map()
  for (const r of db.prepare("SELECT director, country FROM movie WHERE missing = 0 AND director != ''").all()) {
    const countries = movieCountries(r)
    for (const name of String(r.director).split(/[\/、,，;；|]/).map(s => s.trim()).filter(Boolean)) {
      if (!map.has(name)) map.set(name, { name, count: 0, countries: new Set() })
      const e = map.get(name)
      e.count++
      for (const c of countries) e.countries.add(c)
    }
  }
  let items = [...map.values()].map(e => ({ name: e.name, count: e.count, countries: [...e.countries] }))
  items.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))
  const country = String(req.query.country || '').trim()
  if (country) items = items.filter(i => i.countries.includes(country))
  res.json({ items })
})

metaRouter.get('/actors', (req, res) => {
  const map = new Map()
  for (const r of db.prepare("SELECT actors, country FROM movie WHERE missing = 0 AND actors != ''").all()) {
    let arr = []
    try { arr = JSON.parse(r.actors) } catch { continue }
    if (!Array.isArray(arr)) continue
    const countries = movieCountries(r)
    for (const name of arr) {
      if (typeof name === 'string' && name.trim()) {
        const n = name.trim()
        if (!map.has(n)) map.set(n, { name: n, count: 0, countries: new Set() })
        const e = map.get(n)
        e.count++
        for (const c of countries) e.countries.add(c)
      }
    }
  }
  let items = [...map.values()].map(e => ({ name: e.name, count: e.count, countries: [...e.countries] }))
  items.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))
  const country = String(req.query.country || '').trim()
  if (country) items = items.filter(i => i.countries.includes(country))
  res.json({ items })
})

const QUALITY_ORDER = ['8K', '4K', '1080p', '720p', '480p']

metaRouter.get('/', (req, res) => {
  const catSet = new Set()
  const countrySet = new Set()
  const qualitySet = new Set()
  for (const r of db.prepare("SELECT category, country, quality FROM movie WHERE missing = 0").all()) {
    for (const c of parseCategories(r.category)) catSet.add(c)
    for (const c of parseCategories(r.country)) countrySet.add(c)
    if (r.quality) qualitySet.add(r.quality)
  }
  res.json({
    categories: [...catSet].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    countries: [...countrySet].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    qualities: QUALITY_ORDER.filter(q => qualitySet.has(q)),
    years: db.prepare(
      'SELECT DISTINCT year FROM movie WHERE missing = 0 AND year IS NOT NULL ORDER BY year DESC'
    ).all().map(r => r.year),
    tags: db.prepare(`
      SELECT t.id, t.name, COUNT(mt.movie_id) AS movie_count
      FROM tag t LEFT JOIN movie_tag mt ON mt.tag_id = t.id
      GROUP BY t.id, t.name
      ORDER BY t.name COLLATE NOCASE
    `).all(),
    stats: {
      total: db.prepare('SELECT COUNT(*) AS c FROM movie WHERE missing = 0').get().c,
      missing: db.prepare('SELECT COUNT(*) AS c FROM movie WHERE missing = 1').get().c,
      watched: db.prepare('SELECT COUNT(*) AS c FROM movie WHERE missing = 0 AND watched = 1').get().c,
      total_size: db.prepare('SELECT COALESCE(SUM(file_size), 0) AS c FROM movie WHERE missing = 0').get().c
    }
  })
})
