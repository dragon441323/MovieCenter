// 电影资讯：TMDB 官方影讯（正在上映 / 即将上映 / 每周热门），自动标注与库内 / 想看清单的关联
import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { db } from '../db.js'
import { COVERS_DIR } from '../db.js'
import { tmdbFetch, getTmdbConfig, downloadImage, getNewsMovieDetails } from '../tmdb.js'
import { normalizeTitle } from '../wishlist.js'

export const newsRouter = Router()

// 库内 + 想看清单的标题索引（请求时构建，量级几百条，代价可忽略）
function buildIndex() {
  const lib = new Map()   // normalizeTitle -> { id }
  for (const m of db.prepare('SELECT id, title, original_title FROM movie').all()) {
    const t = normalizeTitle(m.title)
    const o = normalizeTitle(m.original_title)
    if (t) lib.set(t, m.id)
    if (o && o !== t) lib.set(o, m.id)
  }
  const want = new Map()  // normalizeTitle -> { id, status }
  for (const w of db.prepare('SELECT id, title, original_title, status FROM wishlist').all()) {
    const t = normalizeTitle(w.title)
    const o = normalizeTitle(w.original_title)
    if (t) want.set(t, w)
    if (o && o !== t) want.set(o, w)
  }
  return { lib, want }
}

const NEWS_POSTERS_DIR = path.join(COVERS_DIR, 'news')
try { fs.mkdirSync(NEWS_POSTERS_DIR, { recursive: true }) } catch {}

/** 影讯海报：按 tmdb_id 落地缓存（浏览器直连 image.tmdb.org 不通，走服务端经代理下载）*/
function newsPosterUrl(m) {
  if (!m.poster_path) return ''
  return `/api/news/poster/${m.id}`
}

/** 演员头像代理（要在 /poster/:tmdbId 之前定义，否则 "profile" 会被当成 tmdbId） */
newsRouter.get('/poster/profile/:file', async (req, res) => {
  const file = String(req.params.file || '').replace(/[^a-zA-Z0-9._-]/g, '')
  if (!/^\w+\.(jpg|png|webp)$/i.test(file)) return res.status(400).end()
  const local = path.join(NEWS_POSTERS_DIR, 'profile', file)
  try {
    res.set('Cache-Control', 'public, max-age=2592000')
    if (fs.existsSync(local)) {
      res.set('Content-Type', 'image/jpeg')
      return fs.createReadStream(local).pipe(res)
    }
    // 首次：下载后直接从内存发（避开 Windows 下「刚写完立即流读」的句柄竞态）
    const buf = await downloadImage('/' + file, 'w185')
    if (!buf) throw new Error('download failed')
    fs.mkdirSync(path.dirname(local), { recursive: true })
    fs.writeFileSync(local, buf)
    res.set('Content-Type', 'image/jpeg')
    res.send(buf)
  } catch {
    res.status(200).set('Content-Type', 'image/svg+xml').send(
      `<svg xmlns="http://www.w3.org/2000/svg" width="185" height="278"><rect width="100%" height="100%" fill="#221b14"/></svg>`
    )
  }
})

/** 海报按需下载（不存在时现拉，下次直接命中磁盘）；TMDB 拉不下来返回占位 SVG */
newsRouter.get('/poster/:tmdbId', async (req, res) => {
  const tmdbId = Number(req.params.tmdbId)
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return res.status(400).end()
  const file = path.join(NEWS_POSTERS_DIR, `${tmdbId}.jpg`)
  try {
    res.set('Cache-Control', 'public, max-age=604800') // 一周：海报不变
    if (fs.existsSync(file)) {
      res.set('Content-Type', 'image/jpeg')
      return fs.createReadStream(file).pipe(res)
    }
    // 从列表缓存里找该片的 poster_path
    let pp = null
    for (const [, v] of cache) {
      const hit = (v.data || []).find(x => x.tmdb_id === tmdbId)
      if (hit?.poster_path) { pp = hit.poster_path; break }
    }
    if (!pp) {
      const d = await tmdbFetch(`/movie/${tmdbId}`)
      pp = d.poster_path
    }
    if (!pp) throw new Error('no poster')
    // 首次：下载后直接从内存发（避开 Windows 下「刚写完立即流读」的句柄竞态）
    const buf = await downloadImage(pp, 'w342')
    if (!buf) throw new Error('download failed')
    fs.writeFileSync(file, buf)
    res.set('Content-Type', 'image/jpeg')
    res.send(buf)
  } catch {
    // 占位：暗色块
    res.status(200).set('Content-Type', 'image/svg+xml').send(
      `<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513"><rect width="100%" height="100%" fill="#1a1511"/></svg>`
    )
  }
})

function decorate(items, { lib, want }) {
  return items.map(m => {
    const nt = normalizeTitle(m.title)
    const no = normalizeTitle(m.original_title)
    const libId = lib.get(nt) || lib.get(no)
    const wl = want.get(nt) || want.get(no)
    return {
      tmdb_id: m.id,
      title: m.title,
      original_title: m.original_title || '',
      year: m.release_date ? Number(m.release_date.slice(0, 4)) || null : null,
      release_date: m.release_date || '',
      poster_url: newsPosterUrl(m),
      poster_path: m.poster_path || '',
      vote_average: m.vote_average ?? null,
      overview: m.overview || '',
      in_library: !!libId,
      movie_id: libId || null,
      in_wishlist: !!wl && wl.status === 'wanted',
      wishlist_id: wl?.id || null
    }
  })
}

const CACHE_TTL = 30 * 60 * 1000 // 30 分钟缓存（TMDB 榜单小时级变化，没必要每次现拉）
const cache = new Map() // tab -> { at, data }

async function fetchTab(tab) {
  const hit = cache.get(tab)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data
  const paths = {
    now: '/movie/now_playing',
    soon: '/movie/upcoming',
    hot: '/trending/movie/week'
  }
  const p = paths[tab]
  if (!p) throw new Error('未知的资讯栏目')
  const data = await tmdbFetch(p, { page: 1 })
  const items = decorate((data.results || []).slice(0, 24), buildIndex())
  cache.set(tab, { at: Date.now(), data: items })
  return items
}

/** 三个栏目合并返回；某栏失败不影响其它（前端按栏目分组展示） */
newsRouter.get('/', async (req, res) => {
  if (!getTmdbConfig().apiKey) {
    return res.status(400).json({ error: '未配置 TMDB API Key，请先在设置中填写' })
  }
  const tabs = ['now', 'soon', 'hot']
  const out = { now: null, soon: null, hot: null, errors: {} }
  await Promise.all(tabs.map(async t => {
    try { out[t] = await fetchTab(t) }
    catch (e) { out.errors[t] = e.message }
  }))
  res.json(out)
})

/** 影讯详情：演员 / 导演 / 时长 / 预告片（带缓存） */
const detailCache = new Map() // tmdbId -> { at, data }
const DETAIL_TTL = 60 * 60 * 1000

function fmtRuntime(min) {
  if (!min) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h} 小时 ${m ? m + ' 分' : ''}`.trim() : `${m} 分钟`
}

newsRouter.get('/detail/:tmdbId', async (req, res) => {
  const tmdbId = Number(req.params.tmdbId)
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return res.status(400).json({ error: '无效的 ID' })
  const hit = detailCache.get(tmdbId)
  if (hit && Date.now() - hit.at < DETAIL_TTL) return res.json(hit.data)
  try {
    const d = await getNewsMovieDetails(tmdbId)
    const cast = (d.credits?.cast || []).slice(0, 12).map(p => ({
      name: p.name,
      character: p.character || '',
      profile: p.profile_path ? `/api/news/poster/profile/${p.profile_path.replace(/^\//, '')}` : ''
    }))
    const directors = (d.credits?.crew || [])
      .filter(c => c.job === 'Director')
      .map(c => ({ name: c.name, profile: c.profile_path ? `/api/news/poster/profile/${c.profile_path.replace(/^\//, '')}` : '' }))
    // 预告片：YouTube 官方 Trailer/Teaser，优先中文
    const vids = (d.videos?.results || []).filter(v => v.site === 'YouTube' && /Trailer|Teaser|Preview|Featurette/i.test(v.type))
    vids.sort((a, b) => {
      const zh = x => /^(zh|cn)/i.test(x.iso_639_1)
      return (zh(b) ? 1 : 0) - (zh(a) ? 1 : 0)
    })
    const trailer = vids[0] ? { key: vids[0].key, name: vids[0].name, type: vids[0].type } : null
    const data = {
      tmdb_id: d.id,
      title: d.title,
      original_title: d.original_title || '',
      runtime: d.runtime || 0,
      runtime_text: fmtRuntime(d.runtime),
      genres: (d.genres || []).map(g => g.name),
      vote_average: d.vote_average ?? null,
      release_date: d.release_date || '',
      overview: d.overview || '',
      cast,
      directors,
      trailer
    }
    detailCache.set(tmdbId, { at: Date.now(), data })
    res.json(data)
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message })
  }
})

/** 加入想看：直接复用 wishlist 导入管线（自动对号库内已有） */
newsRouter.post('/want', async (req, res) => {
  const tmdbId = Number(req.body?.tmdbId)
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return res.status(400).json({ error: '无效的 tmdbId' })
  try {
    const { importWishlist } = await import('../wishlist.js')
    // 从缓存或 TMDB 取标题（缓存里 24 条几乎必然覆盖；未命中再拉详情）
    let item = null
    for (const [, v] of cache) {
      item = (v.data || []).find(x => x.tmdb_id === tmdbId)
      if (item) break
    }
    if (!item) {
      const d = await tmdbFetch(`/movie/${tmdbId}`)
      item = {
        title: d.title,
        original_title: d.original_title || '',
        year: d.release_date ? Number(d.release_date.slice(0, 4)) || null : null
      }
    }
    const r = importWishlist([{ title: item.title, original_title: item.original_title, year: item.year }])
    // 直接查回该条状态返回；同时清缓存让列表立即反映“已在想看”
    const row = db.prepare(
      'SELECT id, status, movie_id FROM wishlist WHERE title = ? ORDER BY id DESC LIMIT 1'
    ).get(item.title)
    cache.clear()
    res.json({ ...r, item: row })
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
})
