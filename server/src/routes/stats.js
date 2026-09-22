import { Router } from 'express'
import { db } from '../db.js'
import { parseCategories, serializeMovie } from './movies.js'

export const statsRouter = Router()

function ratingBuckets(rows, field) {
  const buckets = { '未评分': 0 }
  for (let i = 1; i <= 10; i++) buckets[String(i)] = 0
  for (const r of rows) {
    const v = r[field]
    if (v == null) buckets['未评分']++
    else {
      const bucket = String(Math.min(10, Math.max(1, Math.ceil(v))))
      buckets[bucket] = (buckets[bucket] || 0) + 1
    }
  }
  return Object.entries(buckets).map(([name, count]) => ({ name, count }))
}

function topByCount(map, limit) {
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))
    .slice(0, limit)
}

statsRouter.get('/', (req, res) => {
  const movies = db.prepare('SELECT * FROM movie WHERE missing = 0').all()

  const catMap = new Map()
  const directorMap = new Map()
  const actorMap = new Map()
  const decadeMap = new Map()
  for (const m of movies) {
    for (const c of parseCategories(m.category)) catMap.set(c, (catMap.get(c) || 0) + 1)
    for (const d of String(m.director || '').split(/[/,，、;；|]/).map(s => s.trim()).filter(Boolean)) {
      directorMap.set(d, (directorMap.get(d) || 0) + 1)
    }
    try {
      for (const a of JSON.parse(m.actors || '[]')) {
        if (typeof a === 'string' && a.trim()) actorMap.set(a.trim(), (actorMap.get(a) || 0) + 1)
      }
    } catch {}
    if (m.year) {
      const decade = `${Math.floor(m.year / 10) * 10}s`
      decadeMap.set(decade, (decadeMap.get(decade) || 0) + 1)
    }
  }

  const mostWatched = movies
    .filter(m => m.watch_count > 0)
    .sort((a, b) => b.watch_count - a.watch_count)
    .slice(0, 10)
    .map(m => ({ name: m.title, count: m.watch_count }))

  res.json({
    totals: {
      total: movies.length,
      watched: movies.filter(m => m.watched).length,
      favorites: movies.filter(m => m.favorite).length,
      my_rated: movies.filter(m => m.my_rating != null).length,
      watch_total: movies.reduce((s, m) => s + (m.watch_count || 0), 0),
      total_size: movies.reduce((s, m) => s + (m.file_size || 0), 0),
      top250: movies.filter(m => m.douban_rank != null).length
    },
    my_rating_dist: ratingBuckets(movies, 'my_rating'),
    douban_dist: ratingBuckets(movies, 'douban_rating'),
    tmdb_dist: ratingBuckets(movies, 'rating'),
    categories: topByCount(catMap, 12),
    directors: topByCount(directorMap, 10),
    actors: topByCount(actorMap, 10),
    decades: [...decadeMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    most_watched: mostWatched
  })
})
