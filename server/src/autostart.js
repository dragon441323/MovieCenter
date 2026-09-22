import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

export function getStartupVbsPath() {
  if (!process.env.APPDATA) return null
  return path.join(
    process.env.APPDATA,
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
    'moviecenter.vbs'
  )
}

export function isAutostartEnabled() {
  const vbs = getStartupVbsPath()
  return !!(vbs && fs.existsSync(vbs))
}

export function setAutostart(enabled) {
  const vbs = getStartupVbsPath()
  if (!vbs) {
    const err = new Error('无法定位用户启动目录（APPDATA）')
    err.status = 500
    throw err
  }
  if (!enabled) {
    try { fs.unlinkSync(vbs) } catch {}
    return { enabled: false }
  }
  const bat = path.join(PROJECT_ROOT, 'autostart.bat')
  const content = `CreateObject("Wscript.Shell").Run """${bat}""", 0, False\r\n`
  fs.mkdirSync(path.dirname(vbs), { recursive: true })
  fs.writeFileSync(vbs, content, 'utf8')
  return { enabled: true }
}
