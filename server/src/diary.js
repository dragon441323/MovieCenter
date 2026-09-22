// 观影日记：watch_log 的时间线查询与年度报告聚合
import { db } from './db.js'
import { parseCategories, serializeMovie } from './routes/movies.js'

const PAGE_SIZE = 30

/**
 * 日记时间线：按观看时间倒序，可按年份过滤。
 * 返回条目包含影片摘要（封面/年份/分类/我的评分）。
 */
export function diaryEntries({ year, page = 1, pageSize = PAGE_SIZE }) {
  const where = []
  const params = []
  if (year && Number.isInteger(Number(year))) {
    where.push("substr(w.watched_at, 1, 4) = ?")
    params.push(String(year))
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const total = db.prepare(
    `SELECT COUNT(*) AS c FROM watch_log w ${whereSql}`
  ).get(...params).c

  const p = Math.max(1, parseInt(page) || 1)
  const size = Math.min(100, Math.max(1, parseInt(pageSize) || PAGE_SIZE))
  const rows = db.prepare(`
    SELECT w.*, m.title, m.year AS movie_year, m.cover, m.category, m.my_rating,
           m.watched, m.favorite, m.missing, m.quality
    FROM watch_log w
    JOIN movie m ON m.id = w.movie_id
    ${whereSql}
    ORDER BY w.watched_at DESC, w.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, size, (p - 1) * size)

  const items = rows.map(r => ({
    id: r.id,
    movie_id: r.movie_id,
    title: r.title,
    year: r.movie_year,
    cover_url: r.cover ? `/covers/${r.cover}` : null,
    categories: parseCategories(r.category),
    quality: r.quality,
    watched: !!r.watched,
    favorite: !!r.favorite,
    missing: !!r.missing,
    rating: r.rating,
    current_my_rating: r.my_rating,
    note: r.note,
    source: r.source,
    watched_at: r.watched_at
  }))

  const years = db.prepare(
    "SELECT DISTINCT substr(watched_at, 1, 4) AS y FROM watch_log ORDER BY y DESC"
  ).all().map(r => r.y).filter(Boolean)

  return { total, page: p, page_size: size, items, years }
}

/** 年度观影报告：某年的观看/评分/类型/导演/演员/月份聚合。 */
export function yearReport(year) {
  const y = Number(year)
  if (!Number.isInteger(y) || y < 1900 || y > 2100) {
    const err = new Error('年份无效')
    err.status = 400
    throw err
  }
  const prefix = String(y)

  const logs = db.prepare(`
    SELECT w.movie_id, w.rating, w.note, w.watched_at
    FROM watch_log w
    WHERE substr(w.watched_at, 1, 4) = ?
    ORDER BY w.watched_at
  `).all(prefix)

  const monthCounts = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: 0 }))
  const movieIds = new Set()
  const catMap = new Map()
  const directorMap = new Map()
  const actorMap = new Map()
  const ratedList = []

  for (const log of logs) {
    const mo = Number(String(log.watched_at).slice(5, 7))
    if (mo >= 1 && mo <= 12) monthCounts[mo - 1].count++
    movieIds.add(log.movie_id)
    if (log.rating != null) ratedList.push(log)
  }

  const movies = movieIds.size
    ? db.prepare(`SELECT * FROM movie WHERE id IN (${[...movieIds].map(() => '?').join(',')})`).all(...movieIds)
    : []
  for (const m of movies) {
    for (const c of parseCategories(m.category)) catMap.set(c, (catMap.get(c) || 0) + 1)
    for (const d of String(m.director || '').split(/[/,，、;；|]/).map(s => s.trim()).filter(Boolean)) {
      directorMap.set(d, (directorMap.get(d) || 0) + 1)
    }
    try {
      for (const a of JSON.parse(m.actors || '[]').slice(0, 6)) {
        if (typeof a === 'string' && a.trim()) actorMap.set(a.trim(), (actorMap.get(a) || 0) + 1)
      }
    } catch {}
  }

  const topByCount = (map, n) => [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))
    .slice(0, n)

  const avg = ratedList.length
    ? Math.round((ratedList.reduce((s, r) => s + r.rating, 0) / ratedList.length) * 10) / 10
    : null
  const favorite = ratedList.length
    ? ratedList.reduce((best, r) => (r.rating > best.rating ? r : best), ratedList[0])
    : null
  const favoriteMovie = favorite
    ? movies.find(m => m.id === favorite.movie_id) || null
    : null

  const notes = logs.filter(l => l.note && l.note !== '历史观看记录导入').length

  // 年度五星片单（该年给出 9 分及以上的）
  const fiveStar = ratedList
    .filter(r => r.rating >= 9)
    .map(r => {
      const m = movies.find(x => x.id === r.movie_id)
      return m ? { id: m.id, title: m.title, year: m.year, cover_url: m.cover ? `/covers/${m.cover}` : null, rating: r.rating } : null
    })
    .filter(Boolean)

  return {
    year: y,
    total_watched: logs.length,
    unique_movies: movies.length,
    avg_rating: avg,
    notes_written: notes,
    months: monthCounts,
    categories: topByCount(catMap, 8),
    directors: topByCount(directorMap, 5),
    actors: topByCount(actorMap, 5),
    favorite: favoriteMovie
      ? { id: favoriteMovie.id, title: favoriteMovie.title, year: favoriteMovie.year, rating: favorite.rating, cover_url: favoriteMovie.cover ? `/covers/${favoriteMovie.cover}` : null }
      : null,
    five_star: fiveStar
  }
}
