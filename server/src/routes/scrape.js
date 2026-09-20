import { Router } from 'express'
import { db } from '../db.js'
import * as tmdb from '../tmdb.js'
import { saveCoverBuffer, removeCoverFile } from '../covers.js'
import { attachTags } from './movies.js'
import { updateDoubanRanks } from '../douban.js'

export const scrapeRouter = Router()

const batchState = {
  running: false, total: 0, processed: 0, applied: 0, skipped: 0, failed: 0,
  current: null, startedAt: null, finishedAt: null, errors: []
}

function parseId(raw) {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

function hasCJK(s) {
  return /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(s)
}

function extractLatin(title) {
  const m = String(title || '').match(/[A-Za-z0-9][A-Za-z0-9 .'&:()-]*/)
  return m ? m[0].trim() : null
}

function toCandidate(r) {
  return {
    tmdb_id: r.id,
    title: r.title || r.original_title || '',
    original_title: r.original_title || '',
    year: r.release_date ? Number(r.release_date.slice(0, 4)) : null,
    overview: r.overview || '',
    poster_url: r.poster_path ? tmdb.imageUrl(r.poster_path, 'w185') : null,
    vote_average: r.vote_average || 0
  }
}

function normalizeDetails(m) {
  return {
    tmdb_id: m.id,
    title: m.title || m.original_title || '',
    original_title: m.original_title || '',
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    synopsis: m.overview || '',
    rating: m.vote_average > 0 ? Math.round(m.vote_average * 10) / 10 : null,
    genres: (m.genres || []).map(g => g.name),
    director: (m.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name).slice(0, 3).join(' / '),
    actors: (m.credits?.cast || []).slice(0, 8).map(c => c.name),
    poster_path: m.poster_path || ''
  }
}

function scoreCandidates(movie, candidates) {
  const q = (movie.title || '').trim().toLowerCase()
  const strong = candidates.filter(c =>
    (c.title || '').trim().toLowerCase() === q || (c.original_title || '').trim().toLowerCase() === q
  )
  let pool = strong.length ? strong : candidates
  if (pool.length > 1 && movie.year) {
    const byYear = pool.filter(c => c.year && Math.abs(c.year - movie.year) <= 1)
    if (byYear.length) pool = byYear
  }
  pool = pool.slice(0, 12)
  const confident = pool.length === 1 && strong.includes(pool[0]) &&
    (!movie.year || !pool[0].year || Math.abs(pool[0].year - movie.year) <= 2)
  return { pool, confident: confident ? pool[0] : null }
}

async function applyTmdbToMovie(movieId, m) {
  const movie = db.prepare('SELECT * FROM movie WHERE id = ?').get(movieId)
  if (!movie) {
    const err = new Error('电影不存在')
    err.status = 404
    throw err
  }
  let newCover = ''
  if (m.poster_path) {
    const buf = await tmdb.downloadImage(m.poster_path, 'w500')
    if (buf && buf.length) {
      try {
        newCover = await saveCoverBuffer(movieId, buf)
      } catch {}
    }
  }
  if (newCover) removeCoverFile(movie.cover)
  db.prepare(`
    UPDATE movie SET title = ?, year = ?, synopsis = ?, director = ?, actors = ?, category = ?,
      rating = ?, cover = ?, tmdb_id = ?, original_title = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    m.title || movie.title,
    m.year ?? movie.year,
    m.synopsis,
    m.director,
    JSON.stringify(m.actors),
    JSON.stringify(m.genres),
    m.rating,
    newCover || movie.cover,
    m.tmdb_id,
    m.original_title || movie.original_title || '',
    movieId
  )
  // 标题/年份可能变化，重新匹配豆瓣 Top 250
  try { updateDoubanRanks() } catch {}
  return db.prepare('SELECT * FROM movie WHERE id = ?').get(movieId)
}

async function runBatch(movies) {
  try {
    for (const m of movies) {
      batchState.current = m.title
      try {
        if (m.tmdb_id) {
          // 已有 tmdb_id 的电影只补英文原名，不改动其它字段（避免覆盖用户手动编辑）
          const raw = await tmdb.getMovieDetails(m.tmdb_id)
          if (raw.original_title) {
            db.prepare(
              "UPDATE movie SET original_title = ?, updated_at = datetime('now') WHERE id = ? AND original_title = ''"
            ).run(raw.original_title, m.id)
            batchState.applied++
          } else {
            batchState.skipped++
          }
        } else {
          const results = await tmdb.searchMovies(m.title)
          const { confident } = scoreCandidates(m, results.map(toCandidate))
          if (confident) {
            const raw = await tmdb.getMovieDetails(confident.tmdb_id)
            await applyTmdbToMovie(m.id, normalizeDetails(raw))
            batchState.applied++
          } else {
            batchState.skipped++
          }
        }
      } catch (err) {
        batchState.failed++
        if (batchState.errors.length < 50) batchState.errors.push(`${m.title}: ${err.message}`)
      }
      batchState.processed++
      await new Promise(r => setTimeout(r, 300))
    }
  } finally {
    batchState.running = false
    batchState.current = null
    batchState.finishedAt = new Date().toISOString()
    // 批量补全后标题/原名有变化，重新匹配豆瓣 Top 250
    try { updateDoubanRanks() } catch {}
  }
}

scrapeRouter.get('/batch/status', (req, res) => {
  res.json({ ...batchState })
})

scrapeRouter.get('/test', async (req, res) => {
  const cfg = tmdb.getTmdbConfig()
  if (!cfg.apiKey) return res.status(400).json({ ok: false, message: '未配置 TMDB API Key' })
  const start = Date.now()
  try {
    await tmdb.tmdbFetch('/configuration')
    res.json({ ok: true, message: `连接正常（${Date.now() - start}ms${cfg.proxy ? '，经代理' : '，直连'}）`, ms: Date.now() - start })
  } catch (err) {
    res.json({ ok: false, message: `${err.message}（${Date.now() - start}ms${cfg.proxy ? '，经代理' : '，直连'}）`, ms: Date.now() - start })
  }
})

scrapeRouter.post('/batch', (req, res) => {
  if (batchState.running) return res.status(409).json({ error: 'TMDB 数据同步正在进行中' })
  if (!tmdb.getTmdbConfig().apiKey) {
    return res.status(400).json({ error: '未配置 TMDB API Key，请先在设置中填写' })
  }
  const movies = db.prepare(`
    SELECT * FROM movie
    WHERE missing = 0 AND (
      (tmdb_id IS NULL AND (synopsis = '' OR cover = '' OR year IS NULL OR category = ''))
      OR (tmdb_id IS NOT NULL AND original_title = '')
    )
    ORDER BY id
  `).all()
  Object.assign(batchState, {
    running: true, total: movies.length, processed: 0, applied: 0, skipped: 0, failed: 0,
    current: null, startedAt: new Date().toISOString(), finishedAt: null, errors: []
  })
  runBatch(movies).catch(err => console.error('[scrape] batch failed:', err.message))
  res.json({ started: true, total: movies.length })
})

scrapeRouter.post('/search', async (req, res) => {
  const query = String(req.body?.query || '').trim()
  if (!query) return res.status(400).json({ error: '请输入搜索关键词' })
  const year = Number(req.body?.year)
  let results = await tmdb.searchMovies(query, year)
  if (!results.length && Number.isInteger(year) && year > 0) {
    results = await tmdb.searchMovies(query)
  }
  res.json({ candidates: results.map(toCandidate).slice(0, 20) })
})

scrapeRouter.post('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的 ID' })
  const movie = db.prepare('SELECT * FROM movie WHERE id = ?').get(id)
  if (!movie) return res.status(404).json({ error: '电影不存在' })

  if (req.body?.imdbId) {
    const imdbId = String(req.body.imdbId).trim().toLowerCase()
    if (!imdbId) return res.status(400).json({ error: '无效的 IMDb ID' })
    const found = await tmdb.findByExternalId(imdbId, 'imdb_id')
    const movieResults = found.movie_results || []
    if (!movieResults.length) return res.status(404).json({ error: '未找到该 IMDb ID 对应的电影' })
    const raw = await tmdb.getMovieDetails(movieResults[0].id)
    const updated = await applyTmdbToMovie(id, normalizeDetails(raw))
    return res.json({ status: 'applied', movie: attachTags([updated])[0] })
  }

  if (req.body?.tmdbId) {
    const tmdbId = Number(req.body.tmdbId)
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) return res.status(400).json({ error: '无效的 tmdbId' })
    const raw = await tmdb.getMovieDetails(tmdbId)
    const updated = await applyTmdbToMovie(id, normalizeDetails(raw))
    return res.json({ status: 'applied', movie: attachTags([updated])[0] })
  }

  const results = await tmdb.searchMovies(movie.title)
  const { pool, confident } = scoreCandidates(movie, results.map(toCandidate))
  if (confident) {
    const raw = await tmdb.getMovieDetails(confident.tmdb_id)
    const updated = await applyTmdbToMovie(id, normalizeDetails(raw))
    return res.json({ status: 'applied', movie: attachTags([updated])[0] })
  }
  let candidates = pool
  if (!candidates.length && hasCJK(movie.title)) {
    const latin = extractLatin(movie.title)
    if (latin && latin.length >= 2) {
      candidates = (await tmdb.searchMovies(latin)).map(toCandidate)
    }
  }
  res.json({ status: 'candidates', candidates })
})
