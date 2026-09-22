import { Router } from 'express'
import { backupDb, getBackupInfo } from '../backup.js'
import { isAutostartEnabled, setAutostart } from '../autostart.js'

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
