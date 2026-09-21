import { fetch as undiciFetch } from 'undici'
import { db } from './db.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const TOP250_URL = 'https://movie.douban.com/top250'
const PAGES = 10
const PAGE_SIZE = 25
const PAGE_DELAY = 500
const STALE_MS = 3 * 24 * 3600 * 1000

const sleep = ms => new Promise(r => setTimeout(r, ms))

function friendlyError(err) {
  if (err.name === 'AbortError') {
    const e = new Error('请求豆瓣超时，请稍后重试')
    e.status = 502
    return e
  }
  const code = err?.cause?.code
  if (code) {
    const e = new Error(`无法连接豆瓣 (${code})，请检查网络`)
    e.status = 502
    return e
  }
  if (err?.message === 'fetch failed') {
    const e = new Error('无法连接豆瓣，请检查网络')
    e.status = 502
    return e
  }
  return err
}

async function fetchPage(start) {
  const url = `${TOP250_URL}?start=${start}&filter=`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await undiciFetch(url, {
      headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' },
      signal: controller.signal
    })
    if (res.status === 403) {
      const e = new Error('豆瓣暂时拒绝了请求（403），请稍后再试')
      e.status = 502
      throw e
    }
    if (!res.ok) {
      const e = new Error(`豆瓣请求失败 (${res.status})`)
      e.status = 502
      throw e
    }
    return await res.text()
  } catch (err) {
    throw friendlyError(err)
  } finally {
    clearTimeout(timer)
  }
}

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

export function parseTop250Page(html) {
  const items = []
  const blocks = html.split('<div class="item">').slice(1)
  for (const b of blocks) {
    const rank = Number(/<em[^>]*>\s*(\d+)\s*<\/em>/.exec(b)?.[1])
    const doubanId = /subject\/(\d+)/.exec(b)?.[1]
    if (!rank || !doubanId) continue
    const titleSpans = [...b.matchAll(/<span class="title">([\s\S]*?)<\/span>/g)].map(m => decodeEntities(m[1]).trim())
    const title = titleSpans[0] || ''
    const originalTitle = titleSpans[1] ? titleSpans[1].replace(/^\/+/, '').trim() : ''
    const pText = decodeEntities(/<p>([\s\S]*?)<\/p>/.exec(b)?.[1] || '')
    const year = Number(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/.exec(pText)?.[1]) || null
    const rating = Number(/class="rating_num"[^>]*>([\d.]+)</.exec(b)?.[1]) || null
    items.push({ rank, doubanId, title, originalTitle, year, rating })
  }
  return items
}

export async function fetchTop250() {
  const all = []
  for (let i = 0; i < PAGES; i++) {
    const html = await fetchPage(i * PAGE_SIZE)
    const items = parseTop250Page(html)
    if (!items.length) {
      const e = new Error('豆瓣榜单页面解析失败，页面结构可能已变化')
      e.status = 502
      throw e
    }
    all.push(...items)
    if (i < PAGES - 1) await sleep(PAGE_DELAY)
  }
  if (all.length < 200) {
    const e = new Error(`榜单数据不完整（仅解析到 ${all.length} 条）`)
    e.status = 502
    throw e
  }
  return all
}

export function getTop250() {
  return db.prepare('SELECT * FROM douban_top250 ORDER BY rank').all()
}

export function getTop250UpdatedAt() {
  const row = db.prepare('SELECT value FROM settings WHERE "key" = ?').get('douban_top250_updated_at')
  return row?.value || ''
}

function setSetting(name, value) {
  db.prepare(
    'INSERT INTO settings ("key", value) VALUES (?, ?) ON CONFLICT("key") DO UPDATE SET value = excluded.value'
  ).run(name, value)
}

function normalizeTitle(s) {
  if (!s) return ''
  return decodeEntities(s).toLowerCase()
    .replace(/[\s\u00A0]+/g, '')
    .replace(/[·・:：!！?？'’'"“”‘’、,，.。;；\-—_~*#()（）[\]【】《》<>]/g, '')
}

/**
 * 将库内电影与豆瓣 Top 250 匹配：标题（中文名/原名，容错 ±1 年）一致即视为上榜。
 * 匹配结果写入 movie.douban_rank / movie.douban_id，未上榜的会被清空。
 */
export function updateDoubanRanks() {
  const list = getTop250()
  if (!list.length) return 0

  const byTitle = new Map()
  const byOriginal = new Map()
  for (const e of list) {
    const t = normalizeTitle(e.title)
    const o = normalizeTitle(e.original_title)
    if (t && !byTitle.has(t)) byTitle.set(t, e)
    if (o && o !== t && !byOriginal.has(o)) byOriginal.set(o, e)
  }

  const movies = db.prepare('SELECT id, title, original_title, year FROM movie').all()
  const updates = []
  for (const m of movies) {
    const mt = normalizeTitle(m.title)
    const mtNoYear = mt.replace(/(?:19|20)\d{2}$/, '')
    const mo = normalizeTitle(m.original_title)
    const cand = byTitle.get(mt) || byTitle.get(mtNoYear) || byOriginal.get(mt) || byTitle.get(mo) || byOriginal.get(mo)
    if (!cand) continue
    if (m.year && cand.year && Math.abs(m.year - cand.year) > 1) continue
    updates.push([cand.rank, cand.douban_id, m.id])
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('UPDATE movie SET douban_rank = NULL').run()
    const set = db.prepare('UPDATE movie SET douban_rank = ?, douban_id = ? WHERE id = ?')
    for (const u of updates) set.run(...u)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return updates.length
}

let refreshing = null

export function refreshTop250() {
  if (!refreshing) {
    refreshing = (async () => {
      const entries = await fetchTop250()
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('DELETE FROM douban_top250').run()
        const ins = db.prepare(
          'INSERT INTO douban_top250 (rank, douban_id, title, original_title, year, rating) VALUES (?, ?, ?, ?, ?, ?)'
        )
        for (const e of entries) ins.run(e.rank, e.doubanId, e.title, e.originalTitle, e.year, e.rating)
        setSetting('douban_top250_updated_at', new Date().toISOString())
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
      updateDoubanRanks()
      return entries.length
    })().finally(() => {
      refreshing = null
    })
  }
  return refreshing
}

/** 确保榜单可用：无缓存时现场抓取；缓存超过 3 天时后台静默刷新。 */
export async function ensureTop250() {
  if (!getTop250().length) {
    await refreshTop250()
    return
  }
  const updated = getTop250UpdatedAt()
  if (updated) {
    const age = Date.now() - new Date(updated).getTime()
    if (Number.isFinite(age) && age > STALE_MS) refreshTop250().catch(() => {})
  }
}

// ---------- 豆瓣用户片单同步（rexxar 接口，匿名可用） ----------

const INTERESTS_URL = 'https://m.douban.com/rexxar/api/v2/user'
const SYNC_PAGE_SIZE = 50
const SYNC_PAGE_DELAY = 1200
const SYNC_MAX_PAGES = 40 // 单次同步上限 2000 条，足够覆盖想看+已看

/**
 * 拉取用户某状态的片单一页。
 * 返回 { total, items: [{ doubanId, title, year, poster, rating, subtype, markedAt }] }
 */
async function fetchInterestsPage(uid, status, start) {
  const url = `${INTERESTS_URL}/${uid}/interests?type=movie&status=${status}&start=${start}&count=${SYNC_PAGE_SIZE}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await undiciFetch(url, {
      headers: { 'user-agent': UA, referer: 'https://m.douban.com/', accept: 'application/json' },
      signal: controller.signal
    })
    if (res.status === 403 || res.status === 429) {
      const e = new Error('豆瓣暂时拒绝了请求（可能被限流），稍后再试')
      e.status = 502
      throw e
    }
    if (!res.ok) {
      const e = new Error(`豆瓣请求失败 (${res.status})`)
      e.status = 502
      throw e
    }
    const data = await res.json()
    const items = (data.interests || []).map(i => ({
      doubanId: String(i.subject?.id || ''),
      title: String(i.subject?.title || '').trim(),
      year: Number(i.subject?.year) || null,
      poster: i.subject?.cover_url || '',
      rating: i.rating?.value ?? null,
      subtype: i.subject?.subtype || 'movie',
      markedAt: i.create_time || ''
    })).filter(x => x.doubanId && x.title)
    return { total: Number(data.total) || 0, items }
  } catch (err) {
    throw friendlyError(err)
  } finally {
    clearTimeout(timer)
  }
}

/** 探测某状态第一页（用于同步前的 UID 有效性验证）。 */
export async function fetchUserInterestsFirstPage(uid, status) {
  return fetchInterestsPage(uid, status, 0)
}

/** 分页拉全量（带页间隔 + 失败重试一次）。 */
async function fetchAllInterests(uid, status, onPage) {
  const first = await fetchInterestsPage(uid, status, 0)
  const all = [...first.items]
  if (onPage) onPage(1, Math.ceil(first.total / SYNC_PAGE_SIZE), first.items.length)
  const pages = Math.min(Math.ceil(first.total / SYNC_PAGE_SIZE), SYNC_MAX_PAGES)
  for (let p = 1; p < pages; p++) {
    await sleep(SYNC_PAGE_DELAY)
    let page
    try {
      page = await fetchInterestsPage(uid, status, p * SYNC_PAGE_SIZE)
    } catch (err) {
      // 单页失败重试一次（再等 5s）
      await sleep(5000)
      page = await fetchInterestsPage(uid, status, p * SYNC_PAGE_SIZE)
    }
    all.push(...page.items)
    if (onPage) onPage(p + 1, pages, page.items.length)
  }
  return { total: first.total, items: all }
}

// 同步任务状态（单例：同时只允许一个同步在跑）
const wishSync = {
  running: false, phase: '', total: 0, processed: 0,
  wantedAdded: 0, wantedExisted: 0, watchedMatched: 0,
  startedAt: null, finishedAt: null, error: null
}

export function getWishSyncState() {
  return { ...wishSync }
}

/**
 * 同步豆瓣用户片单到本地：
 * - wish(想看) → wishlist 表（douban_id 优先匹配，带海报/评分）
 * - done(已看) → 与库内影片对号（标已看 + 回填豆瓣评分 + 写观影日记）
 * onApply 由路由层注入（wishlist.js 的同步逻辑），便于解耦。
 */
export function startWishSync(uid, onApply) {
  if (wishSync.running) {
    const err = new Error('豆瓣片单同步正在进行中')
    err.status = 409
    throw err
  }
  Object.assign(wishSync, {
    running: true, phase: 'wish', total: 0, processed: 0,
    wantedAdded: 0, wantedExisted: 0, watchedMatched: 0,
    startedAt: new Date().toISOString(), finishedAt: null, error: null
  })

  ;(async () => {
    // 1. 想看清单（豆瓣 status=mark）
    const wish = await fetchAllInterests(uid, 'mark', (p, pages, n) => {
      wishSync.processed += n
      wishSync.total = pages * SYNC_PAGE_SIZE
    })
    const r1 = onApply.applyWishlist(wish.items)
    wishSync.wantedAdded = r1.added
    wishSync.wantedExisted = r1.existed

    // 2. 已看片单（豆瓣 status=done）
    wishSync.phase = 'done'
    const done = await fetchAllInterests(uid, 'done', (p, pages, n) => {
      wishSync.processed += n
    })
    const r2 = onApply.applyWatched(done.items)
    wishSync.watchedMatched = r2.matched

    return { wish: wish.total, done: done.total }
  })().catch(err => {
    wishSync.error = err.message
    console.error('[douban-sync] failed:', err.message)
  }).finally(() => {
    wishSync.running = false
    wishSync.phase = ''
    wishSync.finishedAt = new Date().toISOString()
  })

  return { started: true }
}

const ratingSync = {
  running: false, total: 0, processed: 0, applied: 0, skipped: 0, failed: 0,
  current: null, startedAt: null, finishedAt: null, aborted: false, message: null, errors: []
}

// 搜索请求间隔（该接口对高频访问敏感，加大间隔并加抖动）
const SEARCH_DELAY = 2000

/** 从 HTML 中提取 marker 后首个完整 JSON 对象（括号配平扫描，正确处理字符串内的花括号）。 */
function extractJsonAfter(html, marker) {
  const mIdx = html.indexOf(marker)
  if (mIdx < 0) return null
  const start = html.indexOf('{', mIdx + marker.length - 1)
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < html.length; i++) {
    const ch = html[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') {
      inStr = true
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) return html.slice(start, i + 1)
    }
  }
  return null
}

/**
 * 豆瓣电影搜索（search.douban.com 页面内嵌 window.__DATA__ JSON）。
 * 返回候选列表：{ doubanId, zh, orig, year, aliases, rating }（已过滤剧集）。
 */
async function searchDoubanPage(query) {
  const url = `https://search.douban.com/movie/subject_search?search_text=${encodeURIComponent(query)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await undiciFetch(url, {
      headers: {
        'user-agent': UA,
        'accept-language': 'zh-CN,zh;q=0.9',
        referer: 'https://movie.douban.com/'
      },
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`豆瓣搜索请求失败 (${res.status})`)
    const html = await res.text()
    const raw = extractJsonAfter(html, 'window.__DATA__')
    if (!raw) throw new Error('豆瓣搜索返回异常（可能被临时限流，请稍后重试）')
    const data = JSON.parse(raw)
    const items = Array.isArray(data.items) ? data.items : []
    const out = []
    for (const it of items) {
      if (!it?.id || /is_tv:'1'/.test(String(it.more_url || ''))) continue
      // 标题格式「中文标题 原始标题‎ (年份)」
      let zh = String(it.title || '').replace(/\u200e/g, '')
      let orig = ''
      let year = null
      const tm = zh.match(/^(.*?)\s*\((\d{4})\)\s*$/)
      if (tm) {
        year = Number(tm[2]) || null
        zh = tm[1]
      }
      const sp = zh.indexOf(' ')
      if (sp >= 0) {
        orig = zh.slice(sp + 1).trim()
        zh = zh.slice(0, sp)
      }
      // 别名（港台等译名）：abstract 里形如「忘形水(港) / 水底情深(台)」
      const aliases = [...String(it.abstract || '').matchAll(/([^/]+?)\((?:港|台)\)/g)]
        .map(x => x[1].trim())
        .filter(Boolean)
      const rv = Number(it.rating?.value)
      out.push({
        doubanId: String(it.id),
        zh,
        orig,
        year,
        aliases,
        rating: Number.isFinite(rv) && rv > 0 ? rv : null
      })
    }
    return out
  } catch (err) {
    throw friendlyError(err)
  } finally {
    clearTimeout(timer)
  }
}

async function fetchSubjectRating(doubanId) {
  const url = `https://m.douban.com/rexxar/api/v2/movie/${doubanId}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await undiciFetch(url, {
      headers: { 'user-agent': UA, referer: 'https://m.douban.com/', accept: 'application/json' },
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`豆瓣条目请求失败 (${res.status})`)
    const data = await res.json()
    const value = Number(data?.rating?.value)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch (err) {
    throw friendlyError(err)
  } finally {
    clearTimeout(timer)
  }
}

/** 带退避重试的搜索（限流/网络抖动时等 15 秒再试一次）。 */
async function searchWithRetry(query) {
  let lastErr
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(15000)
    try {
      return await searchDoubanPage(query)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

/** 用片名在豆瓣搜索并挑出与库内电影匹配的条目（中文/原名/港台别名归一化一致 + 年份容差 ±1）。 */
async function searchDoubanForMovie(movie) {
  const mt = normalizeTitle(movie.title)
  const mo = normalizeTitle(movie.original_title)
  const queries = [...new Set(
    [movie.title, movie.original_title].map(s => s && String(s).trim()).filter(Boolean)
  )]
  for (let qi = 0; qi < queries.length; qi++) {
    if (qi > 0) await sleep(SEARCH_DELAY)
    const list = await searchWithRetry(queries[qi])
    for (const c of list) {
      const nt = normalizeTitle(c.zh)
      const no = normalizeTitle(c.orig)
      const na = c.aliases.map(a => normalizeTitle(a)).filter(Boolean)
      const eq = (a, b) => !!a && !!b && a === b
      const titleMatch =
        eq(nt, mt) || eq(nt, mo) || eq(no, mt) || eq(no, mo) ||
        na.includes(mt) || na.includes(mo)
      if (!titleMatch) continue
      const cy = Number(c.year)
      if (movie.year && cy && Math.abs(movie.year - cy) > 1) continue
      return c
    }
  }
  return null
}

export function getRatingSyncState() {
  return { ...ratingSync }
}

/**
 * 批量同步库内电影的豆瓣评分：
 * - 已有评分的跳过；
 * - 已上榜 Top 250 的直接使用榜单缓存评分（不发请求）；
 * - 有豆瓣 ID 的直接取条目评分；
 * - 其余用片名搜索匹配后取评分（标题归一化 + 年份 ±1，宁缺毋滥）。
 */
export function startRatingSync() {
  if (ratingSync.running) {
    const err = new Error('豆瓣评分同步正在进行中')
    err.status = 409
    throw err
  }
  const movies = db.prepare(
    'SELECT id, title, original_title, year, douban_id, douban_rating FROM movie ORDER BY id'
  ).all()
  Object.assign(ratingSync, {
    running: true, total: movies.length, processed: 0, applied: 0, skipped: 0, failed: 0,
    current: null, startedAt: new Date().toISOString(), finishedAt: null,
    aborted: false, message: null, errors: []
  })

  const top250ById = new Map(getTop250().map(e => [String(e.douban_id), e]))
  const setRating = db.prepare('UPDATE movie SET douban_rating = ?, douban_id = ? WHERE id = ?')
  const setId = db.prepare('UPDATE movie SET douban_id = ? WHERE id = ?')

  ;(async () => {
    let consecutiveFail = 0
    let noMatchStreak = 0
    for (const m of movies) {
      ratingSync.current = m.title
      let didNetwork = false
      let searched = false
      let noMatch = false
      const failedBefore = ratingSync.failed
      try {
        if (m.douban_rating != null) {
          ratingSync.skipped++
        } else if (m.douban_id && top250ById.has(String(m.douban_id))) {
          const cached = top250ById.get(String(m.douban_id))
          if (cached.rating) {
            setRating.run(cached.rating, String(m.douban_id), m.id)
            ratingSync.applied++
          } else {
            ratingSync.skipped++
          }
        } else if (m.douban_id) {
          didNetwork = true
          const rating = await fetchSubjectRating(m.douban_id)
          if (rating != null) {
            setRating.run(rating, String(m.douban_id), m.id)
            ratingSync.applied++
          } else {
            ratingSync.skipped++
          }
        } else {
          didNetwork = true
          searched = true
          const cand = await searchDoubanForMovie(m)
          if (!cand) {
            noMatch = true
            ratingSync.skipped++
          } else if (cand.rating != null) {
            setRating.run(cand.rating, cand.doubanId, m.id)
            ratingSync.applied++
          } else {
            // 搜索命中但豆瓣暂无评分：只记录 ID，下次同步直接按 ID 补
            setId.run(cand.doubanId, m.id)
            ratingSync.skipped++
          }
        }
      } catch (err) {
        ratingSync.failed++
        if (ratingSync.errors.length < 50) ratingSync.errors.push(`${m.title}: ${err.message}`)
      }
      ratingSync.processed++

      // 连续多部失败视为被限流：提前结束本次同步（已获取的进度保留，可随时重跑续传）
      if (ratingSync.failed > failedBefore) {
        consecutiveFail++
        if (consecutiveFail >= 3) {
          ratingSync.aborted = true
          ratingSync.message = '豆瓣搜索连续失败（可能被临时限流），本次提前结束；已获取的评分已保存，稍后再次同步可继续'
          break
        }
      } else {
        consecutiveFail = 0
      }

      // 连续多部搜索无结果：可能是软限流（返回空结果），主动放缓节奏
      if (searched) {
        if (noMatch) {
          noMatchStreak++
          if (noMatchStreak >= 6) {
            await sleep(20000)
            noMatchStreak = 0
          }
        } else {
          noMatchStreak = 0
        }
      }

      if (didNetwork) await sleep(SEARCH_DELAY + Math.random() * 1200)
    }
  })().catch(() => {}).finally(() => {
    ratingSync.running = false
    ratingSync.current = null
    ratingSync.finishedAt = new Date().toISOString()
  })

  return { started: true, total: movies.length }
}
