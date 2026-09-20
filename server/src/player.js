import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { db } from './db.js'

const PLAYER_EXES = ['PotPlayerMini64.exe', 'PotPlayerMini.exe']

function getSetting(name, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE "key" = ?').get(name)
  return row?.value ?? fallback
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function searchRoots() {
  const roots = new Set()
  for (const k of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'LOCALAPPDATA']) {
    if (process.env[k]) roots.add(process.env[k])
  }
  return [...roots]
}

// 通过注册表 App Paths 找 PotPlayer（部分安装器会注册）
function appPathsLookup(exe) {
  const keys = [
    `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`,
    `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`,
    `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`
  ]
  for (const key of keys) {
    try {
      const out = execFileSync('reg.exe', ['query', key, '/ve'], { encoding: 'utf8', windowsHide: true })
      const m = out.match(/REG_SZ\s+(\S.*)\r?$/)
      if (m && isFile(m[1].trim())) return m[1].trim()
    } catch {}
  }
  return null
}

export function findPlayerPath() {
  // 1. 用户手动指定的路径
  const custom = getSetting('player_path')
  if (custom && isFile(custom)) return custom

  // 2. 常见安装目录
  const subDirs = ['DAUM\\PotPlayer', 'DAUM\\PotPlayer64', 'PotPlayer']
  for (const root of searchRoots()) {
    for (const sub of subDirs) {
      for (const exe of PLAYER_EXES) {
        const p = path.join(root, sub, exe)
        if (isFile(p)) return p
      }
    }
  }

  // 3. 注册表 App Paths
  for (const exe of PLAYER_EXES) {
    const p = appPathsLookup(exe)
    if (p) return p
  }

  // 4. PATH
  try {
    const out = execFileSync('where.exe', PLAYER_EXES, { encoding: 'utf8', windowsHide: true })
    const first = out.split(/\r?\n/).find(line => {
      const p = line.trim()
      return p && isFile(p)
    })
    if (first) return first.trim()
  } catch {}

  return null
}

export function playFile(videoFile) {
  const player = findPlayerPath()
  if (!player) {
    const err = new Error('未找到 PotPlayer，请在「设置 → 播放器」中手动指定播放器路径')
    err.status = 400
    throw err
  }
  if (!isFile(videoFile)) {
    const err = new Error('视频文件不存在（可能已被移动或删除）')
    err.status = 404
    throw err
  }
  const child = spawn(player, [videoFile], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  return true
}
