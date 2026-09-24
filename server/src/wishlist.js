// 想看清单：从豆瓣想看列表文本导入、与库内影片自动匹配
import { db } from './db.js'

const STATUS = ['wanted', 'obtained', 'ignored']

export function normalizeTitle(s) {
  if (!s) return ''
  return String(s)
    .toLowerCase()
    .replace(/[\s\u00A0]+/g, '')
    .replace(/[·・:：!！?？'’'"“”‘’、,，.。;；\-—_~*#()（）[\]【】《》<>]/g, '')
}

/**
 * 解析粘贴的想看列表文本。
 * 支持格式（每行一条，自动去掉序号/评分/日期等噪音）：
 *   霸王别姬 / Farewell My Concubine (1993)
 *   1. 星际穿越 (2014)  [已看]
 *   阿凡达
 */
export function parseWishlistText(text) {
  const lines = String(text || '').split(/\r?\n/)
  const items = []
  const seen = new Set()
  for (const raw of lines) {
    let line = raw.trim()
    if (!line) continue
    // 去掉行首序号（"1." "2、" "12．"）
    line = line.replace(/^\s*\d{1,3}\s*[.、．,，]\s*/, '')
    // 去掉常见前缀符号
    line = line.replace(/^[-*•·]\s*/, '')
    // 截断评分/日期/标记等尾部噪音
    line = line.split(/\s{2,}|\t/)[0]
    line = line.replace(/\s*\[.*?\]\s*$/, '').replace(/\s*（已看|未看|想看）\s*$/g, '')
    if (!line) continue

    let title = line
    let originalTitle = ''
    let year = null

    const ym = title.match(/[（(\[]((?:19|20)\d{2})[)）\]]\s*$/)
    if (ym) {
      year = Number(ym[1])
      title = title.slice(0, ym.index).trim()
    }
    // 「中文 / 原名」斜杠分隔：取含汉字的一段作主标题，另一段作原名
    const parts = title.split(/\s*[/｜]\s*/)
    if (parts.length >= 2) {
      let main = parts.find(p => /[\u4e00-\u9fff]/.test(p))
      if (!main) main = parts.find(p => /[A-Za-z]{2,}/.test(p) && !hasCJK(p))
      const other = parts.find(p => p !== main)
      if (main && other) {
        title = main.trim()
        originalTitle = other.trim()
      }
    }
    // 「中文 English」空格分隔（中文段结尾 + 拉丁段开头）
    if (!originalTitle && hasCJK(title)) {
      const m = title.match(/^([\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af][^\sA-Za-z]*(?:\s+[\u4e00-\u9fff\u3400-\u4dbf]+)*)\s+([A-Za-z][A-Za-z0-9 .'&:()-]*)$/)
      if (m && m[2].length >= 2) {
        title = m[1].trim()
        originalTitle = m[2].trim()
      }
    }
    if (!title && originalTitle) {
      title = originalTitle
      originalTitle = ''
    }
    if (!title) continue

    const key = `${normalizeTitle(title)}|${year || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ title, original_title: originalTitle, year })
  }
  return items
}

function hasCJK(s) {
  return /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(String(s))
}

/**
 * 将条目写入 wishlist 表并尝试与库内影片匹配：
 * - 标题归一化一致 + 年份容差 ±1 → matched（标 obtained 并回填 movie_id）
 * - 未匹配的进入 wanted
 */
export function importWishlist(items) {
  const movies = db.prepare('SELECT id, title, original_title, year FROM movie').all()
  const byTitle = new Map()
  const byOriginal = new Map()
  for (const m of movies) {
    const t = normalizeTitle(m.title)
    const o = normalizeTitle(m.original_title)
    if (t && !byTitle.has(t)) byTitle.set(t, m)
    if (o && o !== t && !byOriginal.has(o)) byOriginal.set(o, m)
  }

  const findInLibrary = (title, originalTitle, year) => {
    const nt = normalizeTitle(title)
    const no = normalizeTitle(originalTitle)
    const cands = [
      byTitle.get(nt),
      byOriginal.get(nt),
      byTitle.get(no),
      byOriginal.get(no)
    ].filter(Boolean)
    if (!cands.length) return null
    if (cands.length === 1) return cands[0]
    // 多个同名：用年份挑最接近的
    if (year) {
      const byYear = cands.filter(c => c.year && Math.abs(c.year - year) <= 1)
      if (byYear.length) return byYear[0]
    }
    return cands[0]
  }

  const existingWanted = new Set(
    db.prepare('SELECT id, title, year, douban_id FROM wishlist').all()
      .map(w => `${normalizeTitle(w.title)}|${w.year || ''}`)
  )

  const insert = db.prepare(`
    INSERT INTO wishlist (title, original_title, year, status, movie_id)
    VALUES (?, ?, ?, ?, ?)
  `)
  const markObtained = db.prepare(
    "UPDATE wishlist SET status = 'obtained', movie_id = ?, updated_at = datetime('now') WHERE id = ?"
  )

  let imported = 0, duplicated = 0, matchedCount = 0
  const matchedMovies = []

  db.exec('BEGIN')
  try {
    for (const it of items) {
      const dedupeKey = `${normalizeTitle(it.title)}|${it.year || ''}`
      if (existingWanted.has(dedupeKey)) {
        duplicated++
        continue
      }
      const lib = findInLibrary(it.title, it.original_title, it.year)
      const r = insert.run(it.title, it.original_title || '', it.year || null, lib ? 'obtained' : 'wanted', lib?.id || null)
      existingWanted.add(dedupeKey)
      imported++
      if (lib) {
        matchedCount++
        matchedMovies.push({ wishlist_id: Number(r.lastInsertRowid), movie_id: lib.id, title: it.title })
      }
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return { imported, duplicated, matched: matchedCount, matchedMovies }
}

/**
 * 豆瓣片单同步 → 想看部分：
 * douban_id 已存在则更新海报/评分/年份；不存在则插入 wanted,
 * 并尝试与库内影片匹配（douban_id 优先，标题+年份兜底）。
 */
export function applyDoubanWishlist(items) {
  // 过滤剧集
  const movies = items.filter(i => i.subtype === 'movie')
  const libByDouban = new Map(
    db.prepare('SELECT id, douban_id FROM movie WHERE douban_id IS NOT NULL').all()
      .map(m => [String(m.douban_id), m.id])
  )
  const libByTitle = new Map()
  const libByOriginal = new Map()
  for (const m of db.prepare('SELECT id, title, original_title, year FROM movie').all()) {
    const t = normalizeTitle(m.title)
    const o = normalizeTitle(m.original_title)
    if (t && !libByTitle.has(t)) libByTitle.set(t, m)
    if (o && o !== t && !libByOriginal.has(o)) libByOriginal.set(o, m)
  }

  const insert = db.prepare(`
    INSERT INTO wishlist (title, year, douban_id, poster, douban_rating, status, movie_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const update = db.prepare(`
    UPDATE wishlist SET poster = ?, douban_rating = ?, year = COALESCE(year, ?),
      updated_at = datetime('now')
    WHERE douban_id = ?
  `)

  let added = 0, existed = 0
  db.exec('BEGIN')
  try {
    for (const it of movies) {
      const row = db.prepare('SELECT id, movie_id FROM wishlist WHERE douban_id = ?').get(it.doubanId)
      if (row) {
        update.run(it.poster, it.rating, it.year, it.doubanId)
        existed++
        continue
      }
      // 库内匹配：douban_id 精确优先
      let libId = libByDouban.get(it.doubanId) || null
      if (!libId) {
        const cand = libByTitle.get(normalizeTitle(it.title))
        if (cand && (!it.year || !cand.year || Math.abs(it.year - cand.year) <= 1)) libId = cand.id
      }
      insert.run(it.title, it.year, it.doubanId, it.poster, it.rating, libId ? 'obtained' : 'wanted', libId)
      added++
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return { added, existed }
}

/**
 * 豆瓣片单同步 → 已看部分：
 * 与库内影片对号（douban_id 优先，标题+年份兜底），对上的：
 * - 标已看、回填你的豆瓣评分到 my_rating（仅当为空）
 * - 写观影日记（source=douban，按豆瓣标记时间）
 */
export function applyDoubanWatched(items) {
  const movies = items.filter(i => i.subtype === 'movie')
  const lib = db.prepare('SELECT id, title, original_title, year, douban_id FROM movie').all()
  const byDouban = new Map(
    lib.filter(m => m.douban_id).map(m => [String(m.douban_id), m])
  )
  const byTitle = new Map()
  const byOriginal = new Map()
  for (const m of lib) {
    const t = normalizeTitle(m.title)
    const o = normalizeTitle(m.original_title)
    if (t && !byTitle.has(t)) byTitle.set(t, m)
    if (o && o !== t && !byOriginal.has(o)) byOriginal.set(o, m)
  }

  const setWatched = db.prepare(`
    UPDATE movie SET watched = 1,
      my_rating = COALESCE(my_rating, ?),
      last_watched_at = COALESCE(last_watched_at, ?),
      updated_at = datetime('now')
    WHERE id = ?
  `)
  const setRatingOnly = db.prepare("UPDATE movie SET douban_rating = ? WHERE id = ? AND douban_rating IS NULL")
  const findDiary = db.prepare("SELECT 1 FROM watch_log WHERE movie_id = ? AND source = 'douban'")
  const insertDiary = db.prepare(
    "INSERT INTO watch_log (movie_id, watched_at, rating, note, source, created_at) VALUES (?, ?, ?, ?, 'douban', ?)"
  )

  let matched = 0
  const seen = new Set()
  db.exec('BEGIN')
  try {
    for (const it of movies) {
      let m = byDouban.get(it.doubanId)
      if (!m) {
        const cand = byTitle.get(normalizeTitle(it.title)) || byOriginal.get(normalizeTitle(it.title))
        if (cand && (!it.year || !cand.year || Math.abs(it.year - cand.year) <= 1)) m = cand
      }
      if (!m || seen.has(m.id)) continue
      seen.add(m.id)
      // 豆瓣标记时间 'YYYY-MM-DD HH:MM:SS'（北京时间）→ ISO UTC
      let at = new Date().toISOString()
      if (it.markedAt) {
        const d = new Date(it.markedAt.replace(' ', 'T') + '+08:00')
        if (!Number.isNaN(d.getTime())) at = d.toISOString()
      }
      // 豆瓣评分(1-5星)换算为 10 分制；my_rating 为空时才回填，不覆盖已有
      const myScore = it.rating != null ? it.rating * 2 : null
      setWatched.run(myScore, at, m.id)
      if (it.rating != null) setRatingOnly.run(it.rating, m.id)
      // 每部只写一条 douban 来源的日记（幂等）
      if (!findDiary.get(m.id)) {
        insertDiary.run(m.id, at, myScore, it.rating ? `豆瓣标记已看，评分 ${it.rating} 星（换算 ${myScore} 分）` : '豆瓣标记已看', at)
      }
      matched++
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return { matched }
}

/**
 * 对 wanted 条目执行 TMDB 搜索回填（poster/tmdb_id），便于展示想看海报墙。
 */
export function getWishlist(status) {
  const st = STATUS.includes(status) ? status : null
  const rows = st
    ? db.prepare('SELECT * FROM wishlist WHERE status = ? ORDER BY id DESC').all(st)
    : db.prepare('SELECT * FROM wishlist ORDER BY id DESC').all()
  return rows.map(w => ({
    ...w,
    // 豆瓣外链海报走本地代理（图床防盗链）；本地文件名直接用 covers 目录
    poster_url: w.poster
      ? (/^https?:\/\//i.test(w.poster)
        ? `/api/wishlist/poster?url=${encodeURIComponent(w.poster)}`
        : `/covers/${w.poster}`)
      : null,
    in_library: !!w.movie_id
  }))
}

export function setWishlistStatus(id, status, movieId) {
  if (!STATUS.includes(status)) {
    const err = new Error('无效的状态')
    err.status = 400
    throw err
  }
  const row = db.prepare('SELECT * FROM wishlist WHERE id = ?').get(id)
  if (!row) {
    const err = new Error('条目不存在')
    err.status = 404
    throw err
  }
  db.prepare(
    "UPDATE wishlist SET status = ?, movie_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, movieId ?? row.movie_id, id)
  return db.prepare('SELECT * FROM wishlist WHERE id = ?').get(id)
}

export function removeWishlist(id) {
  const r = db.prepare('DELETE FROM wishlist WHERE id = ?').run(id)
  if (!r.changes) {
    const err = new Error('条目不存在')
    err.status = 404
    throw err
  }
  return true
}

/**
 * 扫描入库后调用：把 wanted 条目与新入库影片自动匹配。
 * 返回本次匹配上的条目数。
 */
export function matchWishlistToLibrary() {
  const wanted = db.prepare("SELECT * FROM wishlist WHERE status = 'wanted'").all()
  if (!wanted.length) return 0

  const movies = db.prepare('SELECT id, title, original_title, year FROM movie').all()
  const byTitle = new Map()
  const byOriginal = new Map()
  for (const m of movies) {
    const t = normalizeTitle(m.title)
    const o = normalizeTitle(m.original_title)
    if (t && !byTitle.has(t)) byTitle.set(t, m)
    if (o && o !== t && !byOriginal.has(o)) byOriginal.set(o, m)
  }

  const update = db.prepare(
    "UPDATE wishlist SET status = 'obtained', movie_id = ?, updated_at = datetime('now') WHERE id = ?"
  )
  let matched = 0
  db.exec('BEGIN')
  try {
    for (const w of wanted) {
      const nt = normalizeTitle(w.title)
      const no = normalizeTitle(w.original_title)
      let lib = byTitle.get(nt) || byOriginal.get(nt) || byTitle.get(no) || byOriginal.get(no)
      if (!lib) continue
      if (w.year && lib.year && Math.abs(w.year - lib.year) > 1) continue
      update.run(lib.id, w.id)
      matched++
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return matched
}
