import fs from 'node:fs'
import path from 'node:path'
import { db, DATA_DIR } from './db.js'

const BACKUP_DIR = path.join(DATA_DIR, 'backups')
const KEEP = 8
const WEEK_MS = 7 * 24 * 3600 * 1000

function getSetting(name) {
  return db.prepare('SELECT value FROM settings WHERE "key" = ?').get(name)?.value || ''
}

function setSetting(name, value) {
  db.prepare(
    'INSERT INTO settings ("key", value) VALUES (?, ?) ON CONFLICT("key") DO UPDATE SET value = excluded.value'
  ).run(name, value)
}

function listBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter(f => /^moviecenter-[\dT:-]+(-\d+)?\.db$/.test(f))
      .map(f => {
        const full = path.join(BACKUP_DIR, f)
        const st = fs.statSync(full)
        return { file: f, size: st.size, created_at: st.mtime.toISOString() }
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  } catch {
    return []
  }
}

function rotate(excludeFile) {
  const files = listBackups()
  for (let i = KEEP; i < files.length; i++) {
    const full = path.join(BACKUP_DIR, files[i].file)
    if (full === excludeFile) continue
    try { fs.unlinkSync(full) } catch {}
  }
}

export function backupDb() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  let file = path.join(BACKUP_DIR, `moviecenter-${ts}.db`)
  let n = 1
  while (fs.existsSync(file)) {
    file = path.join(BACKUP_DIR, `moviecenter-${ts}-${n++}.db`)
  }
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  setSetting('last_backup_at', new Date().toISOString())
  rotate(file)
  const size = fs.statSync(file).size
  return { file: path.basename(file), size, backups: listBackups() }
}

export function getBackupInfo() {
  return { last_backup_at: getSetting('last_backup_at'), backups: listBackups(), dir: BACKUP_DIR }
}

export function ensureWeeklyBackup() {
  const last = getSetting('last_backup_at')
  const stale = !last || Number.isNaN(new Date(last).getTime()) ||
    Date.now() - new Date(last).getTime() > WEEK_MS
  if (!stale) return false
  try {
    backupDb()
    console.log('[backup] weekly backup created')
    return true
  } catch (err) {
    console.error('[backup] failed:', err.message)
    return false
  }
}
