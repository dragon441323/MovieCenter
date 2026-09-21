import fs from 'node:fs/promises'
import path from 'node:path'
import { db } from './db.js'
import { updateDoubanRanks } from './douban.js'
import { buildSearchText } from './search.js'
import { parseQuality } from './quality.js'
import { probeQualityBatch } from './probe.js'

const VIDEO_EXTS = new Set([
  '.mkv', '.mp4', '.avi', '.rmvb', '.rm', '.ts', '.iso', '.m2ts', '.mts',
  '.wmv', '.mov', '.flv', '.mpg', '.mpeg', '.webm', '.vob', '.m4v',
  '.3gp', '.tp', '.divx', '.f4v', '.asf'
])

const MAX_DEPTH = 5

const scanState = {
  scanning: false,
  startedAt: null,
  finishedAt: null,
  lastResult: null
}

export function getScanState() {
  return { ...scanState }
}

function parseTitleAndYear(folderName) {
  const m = folderName.match(/^(.+?)[\s._]*[\[(](\d{4})[)\]]\s*$/)
  if (m) return { title: m[1].trim(), year: Number(m[2]) }
  return { title: folderName, year: null }
}

async function collectVideoFiles(dir, depth, out) {
  if (depth > MAX_DEPTH) return out
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectVideoFiles(full, depth + 1, out)
    } else if (entry.isFile() && VIDEO_EXTS.has(path.extname(entry.name).toLowerCase())) {
      try {
        const st = await fs.stat(full)
        out.push({ file: full, size: st.size })
      } catch {}
    }
  }
  return out
}

// ---------- 增量扫描：目录签名 ----------
// 签名 = 目录条目列表的指纹（名字 + 类型 + mtimeMs）。
// 目录内容有任何增删改名，签名必然变化；签名未变则跳过整棵子树。

function readCacheSig(p) {
  try {
    return db.prepare('SELECT sig FROM scan_cache WHERE path = ?').get(p)?.sig || null
  } catch {
    return null
  }
}

function writeCacheSig(p, sig) {
  try {
    db.prepare(
      'INSERT INTO scan_cache (path, sig) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET sig = excluded.sig'
    ).run(p, sig)
  } catch {}
}

/**
 * 计算目录签名：只列一层条目（名字/类型/mtime），不递归。
 * 目录不可读返回 null（视为有变化，走完整扫描）。
 */
async function dirSignature(dir) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const parts = []
  for (const e of entries) {
    let mtime = 0
    try {
      const st = await fs.stat(path.join(dir, e.name))
      mtime = Math.trunc(st.mtimeMs)
    } catch {}
    parts.push(`${e.name}:${e.isDirectory() ? 'd' : 'f'}:${mtime}`)
  }
  parts.sort()
  let h = 2166136261
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return `v1:${(h >>> 0).toString(36)}:${entries.length}`
}

export async function scanAll(opts = {}) {
  if (scanState.scanning) {
    const err = new Error('扫描正在进行中')
    err.status = 409
    throw err
  }
  scanState.scanning = true
  scanState.startedAt = new Date().toISOString()
  try {
    const forceFull = !!opts.forceFull
    const roots = db.prepare('SELECT * FROM scan_path WHERE enabled = 1').all()
    const existing = db.prepare('SELECT id, path, missing, quality FROM movie').all()
    const existingByPath = new Map(existing.map(m => [m.path.toLowerCase(), m]))
    const found = new Map()
    const scannedRoots = new Set()
    const rootErrors = []
    let skippedDirs = 0
    let scannedDirs = 0

    for (const root of roots) {
      let entries
      try {
        entries = await fs.readdir(root.path, { withFileTypes: true })
        scannedRoots.add(path.resolve(root.path).toLowerCase())
      } catch (err) {
        rootErrors.push({ path: root.path, error: err.message })
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const full = path.resolve(root.path, entry.name)
        const key = full.toLowerCase()
        if (found.has(key)) continue

        if (!forceFull) {
          const cached = readCacheSig(full)
          if (cached) {
            const fresh = await dirSignature(full)
            if (fresh && fresh === cached) {
              // 目录未变化：直接复用库内记录，跳过整棵子树的遍历
              const ex = existingByPath.get(key)
              if (ex && !ex.missing) {
                skippedDirs++
                found.set(key, null) // 占位：标记“已知未变化”，DB 更新阶段跳过
                continue
              }
            }
          }
        }

        const videos = await collectVideoFiles(full, 1, [])
        scannedDirs++
        writeCacheSig(full, (await dirSignature(full)) || '')
        if (!videos.length) continue
        videos.sort((a, b) => b.size - a.size)
        found.set(key, {
          path: full,
          title: entry.name,
          video_file: videos[0].file,
          file_size: videos.reduce((sum, v) => sum + v.size, 0)
        })
      }
    }

    const now = new Date().toISOString()
    let added = 0, updated = 0, restored = 0, missingCount = 0

    try {
      db.exec('BEGIN IMMEDIATE')
      const insert = db.prepare(
        'INSERT INTO movie (title, year, path, video_file, file_size, quality, search_text, last_scan_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      const update = db.prepare(
        'UPDATE movie SET video_file = ?, file_size = ?, quality = ?, last_scan_at = ?, missing = 0, updated_at = ? WHERE id = ?'
      )
      const markMissing = db.prepare('UPDATE movie SET missing = 1, updated_at = ? WHERE id = ?')

      for (const [key, info] of found) {
        if (!info) continue // 未变化目录的占位
        const quality = parseQuality(info.title, info.video_file)
        const ex = existingByPath.get(key)
        if (ex) {
          // 文件名无法判断时保留既有画质（可能来自 ffprobe 深度识别）
          update.run(info.video_file, info.file_size, quality || ex.quality || '', now, now, ex.id)
          if (ex.missing) restored++
          else updated++
        } else {
          const { title, year } = parseTitleAndYear(info.title)
          insert.run(title, year, info.path, info.video_file, info.file_size, quality, buildSearchText(title), now)
          added++
        }
      }
      for (const m of existing) {
        if (m.missing) continue
        if (found.has(m.path.toLowerCase())) continue
        if (scannedRoots.has(path.dirname(m.path).toLowerCase())) {
          markMissing.run(now, m.id)
          missingCount++
        }
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }

    // ffprobe 深度识别：仅处理文件名判断不出画质的影片
    let probedQuality = 0
    try {
      const emptyQ = db.prepare(
        "SELECT id, video_file FROM movie WHERE missing = 0 AND quality = '' AND video_file != ''"
      ).all()
      if (emptyQ.length) {
        const updates = await probeQualityBatch(emptyQ)
        if (updates.length) {
          const updQ = db.prepare('UPDATE movie SET quality = ? WHERE id = ?')
          db.exec('BEGIN')
          for (const u of updates) updQ.run(u.quality, u.id)
          db.exec('COMMIT')
          probedQuality = updates.length
        }
      }
    } catch (err) {
      console.error('[scan] probe quality failed:', err.message)
    }

    // 扫描入库后重新匹配豆瓣 Top 250（榜单未抓取过时跳过）
    try { updateDoubanRanks() } catch {}

    const result = {
      startedAt: scanState.startedAt,
      finishedAt: new Date().toISOString(),
      rootsScanned: scannedRoots.size,
      rootErrors,
      added,
      updated,
      restored,
      missing: missingCount,
      probedQuality,
      incremental: skippedDirs,
      scannedDirs,
      totalMovies: db.prepare('SELECT COUNT(*) AS c FROM movie WHERE missing = 0').get().c
    }
    scanState.lastResult = result
    return result
  } finally {
    scanState.scanning = false
  }
}

export function clearScanCache() {
  try { db.prepare('DELETE FROM scan_cache').run() } catch {}
}

export async function detectDefaultMoviePaths() {
  const letters = []
  for (let code = 65; code <= 90; code++) letters.push(String.fromCharCode(code))
  const results = await Promise.all(letters.map(async letter => {
    const dir = `${letter}:\\电影`
    try {
      const st = await fs.stat(dir)
      return st.isDirectory() ? dir : null
    } catch {
      return null
    }
  }))
  return results.filter(Boolean)
}

export async function addDefaultMoviePaths() {
  const found = await detectDefaultMoviePaths()
  const existing = new Set(
    db.prepare('SELECT path FROM scan_path').all().map(r => r.path.toLowerCase())
  )
  const insert = db.prepare('INSERT INTO scan_path (path) VALUES (?)')
  const added = []
  for (const dir of found) {
    if (existing.has(dir.toLowerCase())) continue
    insert.run(dir)
    added.push(dir)
  }
  return { found, added }
}
