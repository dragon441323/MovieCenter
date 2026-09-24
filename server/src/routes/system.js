import { Router } from 'express'
import os from 'node:os'
import { backupDb, getBackupInfo } from '../backup.js'
import { isAutostartEnabled, setAutostart } from '../autostart.js'
import { getSessionDetails, transcodeStats } from '../stream.js'
import { watcherStatus } from '../watcher.js'
import { ffprobeAvailable } from '../probe.js'

export const systemRouter = Router()

systemRouter.get('/backup', (req, res) => {
  res.json(getBackupInfo())
})

systemRouter.post('/backup', (req, res) => {
  try {
    res.json(backupDb())
  } catch (err) {
    err.status = err.status || 500
    throw err
  }
})

systemRouter.get('/autostart', (req, res) => {
  res.json({ enabled: isAutostartEnabled() })
})

systemRouter.post('/autostart', (req, res) => {
  const enabled = !!req.body?.enabled
  res.json(setAutostart(enabled))
})

/** 性能监控：系统负载 + 内存 + 转码会话 + watcher 状态（3 秒轮询用） */
systemRouter.get('/monitor', async (req, res) => {
  const total = os.totalmem()
  const free = os.freemem()
  const load = os.loadavg?.() || [0, 0, 0] // Windows 无 loadavg，进程 CPU 另算
  const uptime = os.uptime()
  const mem = process.memoryUsage()

  res.json({
    time: Date.now(),
    system: {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      cpu_model: os.cpus()[0]?.model || '',
      cpu_cores: os.cpus().length,
      uptime,
      mem_total: total,
      mem_free: free,
      mem_used_pct: total ? Math.round((total - free) / total * 100) : 0,
      load: load.map(l => Math.round(l * 100) / 100)
    },
    process: {
      pid: process.pid,
      rss: mem.rss,
      heap_used: mem.heapUsed,
      heap_total: mem.heapTotal,
      external: mem.external,
      node_uptime: process.uptime(),
      // Windows 下 loadavg 恒为 0：用进程 CPU 时间粗略示意（两次采样由前端差分）
      cpu_user: process.cpuUsage().user,
      cpu_system: process.cpuUsage().system
    },
    transcode: {
      ...transcodeStats(),
      sessions: getSessionDetails()
    },
    watcher: watcherStatus(),
    ffprobe: await ffprobeAvailable()
  })
})
