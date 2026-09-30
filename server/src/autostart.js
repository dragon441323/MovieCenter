import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// autostart.js 在 server/src/ 下,项目根要上两级(原来只上一级,指向了 server/,导致 vbs 引用不存在的 server\autostart.bat)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

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
  if (!fs.existsSync(bat)) {
    const err = new Error(`未找到 ${bat}，无法设置开机自启`)
    err.status = 500
    throw err
  }
  // On Error Resume Next：即使 bat 被移动/删除也静默退出，开机时不弹脚本错误窗口
  const content = `On Error Resume Next\r\nCreateObject("Wscript.Shell").Run """${bat}""", 0, False\r\n`
  fs.mkdirSync(path.dirname(vbs), { recursive: true })
  fs.writeFileSync(vbs, content, 'utf8')
  return { enabled: true }
}
