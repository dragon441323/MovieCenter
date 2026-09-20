import fs from 'node:fs/promises'
import path from 'node:path'
import { db } from './db.js'

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

export async function scanAll() {
  if (scanState.scanning) {
    const err = new Error('扫描正在进行中')
    err.status = 409
    throw err
  }
  scanState.scanning = true
  scanState.startedAt = new Date().toISOString()
  try {
    const roots = db.prepare('SELECT * FROM scan_path WHERE enabled = 1').all()
    const found = new Map()
    const scannedRoots = new Set()
    const rootErrors = []

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
        const videos = await collectVideoFiles(full, 1, [])
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
    const existing = db.prepare('SELECT id, path, missing FROM movie').all()
    const existingByPath = new Map(existing.map(m => [m.path.toLowerCase(), m]))
    let added = 0, updated = 0, restored = 0, missingCount = 0

    try {
      db.exec('BEGIN IMMEDIATE')
      const insert = db.prepare(
        'INSERT INTO movie (title, year, path, video_file, file_size, last_scan_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      const update = db.prepare(
        'UPDATE movie SET video_file = ?, file_size = ?, last_scan_at = ?, missing = 0, updated_at = ? WHERE id = ?'
      )
      const markMissing = db.prepare('UPDATE movie SET missing = 1, updated_at = ? WHERE id = ?')

      for (const [key, info] of found) {
        const ex = existingByPath.get(key)
        if (ex) {
          update.run(info.video_file, info.file_size, now, now, ex.id)
          if (ex.missing) restored++
          else updated++
        } else {
          const { title, year } = parseTitleAndYear(info.title)
          insert.run(title, year, info.path, info.video_file, info.file_size, now)
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

    const result = {
      startedAt: scanState.startedAt,
      finishedAt: new Date().toISOString(),
      rootsScanned: scannedRoots.size,
      rootErrors,
      added,
      updated,
      restored,
      missing: missingCount,
      totalMovies: db.prepare('SELECT COUNT(*) AS c FROM movie WHERE missing = 0').get().c
    }
    scanState.lastResult = result
    return result
  } finally {
    scanState.scanning = false
  }
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
