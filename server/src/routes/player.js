import { Router } from 'express'
import { findPlayerPath } from '../player.js'

export const playerRouter = Router()

playerRouter.get('/', (req, res) => {
  res.json({ path: findPlayerPath() })
})
