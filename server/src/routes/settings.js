import { Router } from 'express'
import { db } from '../db.js'

export const settingsRouter = Router()

const LANGS = ['zh-CN', 'zh-TW', 'en-US']

function getSettings() {
  const rows = db.prepare('SELECT "key", value FROM settings').all()
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]))
  return {
    tmdb_api_key: map.tmdb_api_key || '',
    tmdb_language: LANGS.includes(map.tmdb_language) ? map.tmdb_language : 'zh-CN',
    tmdb_proxy: map.tmdb_proxy || ''
  }
}

function upsert(key, value) {
  db.prepare('INSERT INTO settings ("key", value) VALUES (?, ?) ON CONFLICT("key") DO UPDATE SET value = excluded.value').run(key, value)
}

settingsRouter.get('/', (req, res) => {
  res.json(getSettings())
})

settingsRouter.put('/', (req, res) => {
  const b = req.body || {}
  if ('tmdb_api_key' in b) upsert('tmdb_api_key', String(b.tmdb_api_key || '').trim())
  if ('tmdb_proxy' in b) {
    const proxy = String(b.tmdb_proxy || '').trim().replace(/\/+$/, '')
    if (proxy && !/^https?:\/\/.+/i.test(proxy)) {
      return res.status(400).json({ error: '代理地址需以 http:// 或 https:// 开头' })
    }
    upsert('tmdb_proxy', proxy)
  }
  if ('tmdb_language' in b) {
    const lang = String(b.tmdb_language || '')
    if (!LANGS.includes(lang)) return res.status(400).json({ error: '不支持的语言' })
    upsert('tmdb_language', lang)
  }
  res.json(getSettings())
})
