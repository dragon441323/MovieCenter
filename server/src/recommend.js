// 智能推荐：基于库内数据的相似影片评分与口味画像
import { db } from './db.js'
import { parseCategories } from './routes/movies.js'

function safeParseActors(v) {
  try {
    const arr = JSON.parse(v || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function splitDirectors(value) {
  return String(value || '').split(/[/,，、;；|]/).map(s => s.trim()).filter(Boolean)
}

/**
 * 计算单部影片与候选集的相似度分数（分值越高越相似）。
 * 权重：共同导演 3 分/人，主演 2 分/人，类型 1.5 分/个，国家 1 分/个，
 * 年代相近 +1，同一合集 +4（排除自身）。
 */
export function scoreSimilar(base, candidate) {
  if (base.id === candidate.id) return -1
  let score = 0

  const baseDirectors = new Set(splitDirectors(base.director))
  for (const d of splitDirectors(candidate.director)) {
    if (baseDirectors.has(d)) score += 3
  }

  const baseActors = new Set(base.actors)
  for (const a of candidate.actors) {
    if (baseActors.has(a)) score += 2
  }

  const baseCats = new Set(base.categories)
  for (const c of candidate.categories) {
    if (baseCats.has(c)) score += 1.5
  }

  const baseCountries = new Set(base.countries)
  for (const c of candidate.countries) {
    if (baseCountries.has(c)) score += 1
  }

  if (base.year && candidate.year && Math.abs(base.year - candidate.year) <= 5) score += 1

  if (base.collection_id && base.collection_id === candidate.collection_id) score += 4

  return score
}

/**
 * 相似影片推荐：返回与指定影片最相似的 N 部（missing = 0）。
 * 相似度 > 0 才入选；不足时用“同类型高分”补齐。
 */
export function similarMovies(movieId, limit = 8) {
  const base = db.prepare('SELECT * FROM movie WHERE id = ?').get(movieId)
  if (!base) return []

  const baseInfo = {
    id: base.id,
    director: base.director,
    actors: safeParseActors(base.actors),
    categories: parseCategories(base.category),
    countries: parseCategories(base.country),
    year: base.year,
    collection_id: base.collection_id
  }

  const all = db.prepare('SELECT * FROM movie WHERE missing = 0 AND id != ?').all(movieId)
  const scored = []
  for (const m of all) {
    const info = {
      id: m.id,
      director: m.director,
      actors: safeParseActors(m.actors),
      categories: parseCategories(m.category),
      countries: parseCategories(m.country),
      year: m.year,
      collection_id: m.collection_id
    }
    const s = scoreSimilar(baseInfo, info)
    if (s > 0) scored.push({ id: m.id, score: s })
  }
  scored.sort((a, b) => b.score - a.score)
  let picked = scored.slice(0, limit).map(x => x.id)

  // 不足时用同类型高分影片补齐
  if (picked.length < limit && baseInfo.categories.length) {
    const excludes = new Set([movieId, ...picked])
    const extra = db.prepare(`
      SELECT id FROM movie
      WHERE missing = 0 AND id NOT IN (${[...excludes].map(() => '?').join(',') || '0'})
        AND (category LIKE ? OR category LIKE ?)
      ORDER BY COALESCE(douban_rating, rating, 0) DESC
      LIMIT ?
    `)
    const like1 = `%"${baseInfo.categories[0]}"%`
    const like2 = baseInfo.categories[1] ? `%"${baseInfo.categories[1]}"%` : like1
    for (const r of extra.all(...excludes, like1, like2, limit - picked.length)) {
      picked.push(r.id)
    }
  }

  if (!picked.length) return []
  const rows = db.prepare(
    `SELECT * FROM movie WHERE id IN (${picked.map(() => '?').join(',')})`
  ).all(...picked)
  const byId = new Map(rows.map(r => [r.id, r]))
  const scoreById = new Map(scored)
  return picked
    .map(id => byId.get(id))
    .filter(Boolean)
    .map(r => ({
      ...r,
      actors: safeParseActors(r.actors),
      categories: parseCategories(r.category),
      countries: parseCategories(r.country),
      cover_url: r.cover ? `/covers/${r.cover}` : null,
      similarity: scoreById.get(r.id) || 0
    }))
}

/** 从用户的观看/评分行为提炼口味画像（用于盲盒“按口味随机”）。 */
export function tasteProfile() {
  const rated = db.prepare('SELECT * FROM movie WHERE my_rating IS NOT NULL').all()
  const watched = db.prepare('SELECT * FROM movie WHERE watched = 1 AND my_rating IS NULL').all()

  // 权重：评分归一到 0~1（>6 记满权重，<=6 减半），观看过未评分记 0.5
  const weightOf = m => {
    if (m.my_rating != null) {
      const w = (m.my_rating - 5) / 5
      return Math.max(0.25, Math.min(1, w + 0.25))
    }
    return 0.5
  }

  const cats = new Map()
  const directors = new Map()
  const actors = new Map()
  const decades = new Map()

  for (const m of [...rated, ...watched]) {
    const w = weightOf(m)
    for (const c of parseCategories(m.category)) cats.set(c, (cats.get(c) || 0) + w)
    for (const d of splitDirectors(m.director)) directors.set(d, (directors.get(d) || 0) + w)
    for (const a of safeParseActors(m.actors).slice(0, 6)) actors.set(a, (actors.get(a) || 0) + w)
    if (m.year) {
      const dec = `${Math.floor(m.year / 10) * 10}s`
      decades.set(dec, (decades.get(dec) || 0) + w)
    }
  }

  const top = (map, n) => [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, weight]) => ({ name, weight: Math.round(weight * 100) / 100 }))

  return {
    samples: rated.length + watched.length,
    categories: top(cats, 8),
    directors: top(directors, 6),
    actors: top(actors, 8),
    decades: top(decades, 4)
  }
}

/** 为未看影片按口味打分（盲盒口味模式用）。 */
export function scoreUnwatchedByTaste(profile, movie) {
  let score = 0
  const catW = new Map(profile.categories.map(c => [c.name, c.weight]))
  for (const c of parseCategories(movie.category)) score += (catW.get(c) || 0) * 2
  const dirW = new Map(profile.directors.map(d => [d.name, d.weight]))
  for (const d of splitDirectors(movie.director)) score += (dirW.get(d) || 0) * 1.5
  const actW = new Map(profile.actors.map(a => [a.name, a.weight]))
  for (const a of safeParseActors(movie.actors).slice(0, 6)) score += (actW.get(a) || 0) * 0.8
  const decW = new Map(profile.decades.map(d => [d.name, d.weight]))
  if (movie.year) {
    const dec = `${Math.floor(movie.year / 10) * 10}s`
    score += (decW.get(dec) || 0) * 0.5
  }
  // 分数叠加豆瓣/TMDB 评分的小幅加成
  score += (movie.douban_rating || movie.rating || 6) * 0.15
  return score
}
