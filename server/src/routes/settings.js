import { Router } from 'express'
import fs from 'node:fs'
import { db } from '../db.js'
import { ffprobeAvailable } from '../probe.js'

export const settingsRouter = Router()

const LANGS = ['zh-CN', 'zh-TW', 'en-US']

function getSettings() {
  const rows = db.prepare('SELECT "key", value FROM settings').all()
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]))
  return {
    tmdb_api_key: map.tmdb_api_key || '',
    tmdb_language: LANGS.includes(map.tmdb_language) ? map.tmdb_language : 'zh-CN',
    tmdb_proxy: map.tmdb_proxy || '',
    player_path: map.player_path || '',
    douban_uid: map.douban_uid || '',
    watch_enabled: (map.watch_enabled ?? '1') === '1'
  }
}

function upsert(key, value) {
  db.prepare('INSERT INTO settings ("key", value) VALUES (?, ?) ON CONFLICT("key") DO UPDATE SET value = excluded.value').run(key, value)
}

settingsRouter.get('/', async (req, res) => {
  res.json({ ...getSettings(), probe_available: await ffprobeAvailable() })
})

settingsRouter.put('/', async (req, res) => {
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
  if ('player_path' in b) {
    const p = String(b.player_path || '').trim()
    if (p && !fs.existsSync(p)) {
      return res.status(400).json({ error: '播放器路径不存在，请检查后重试' })
    }
    upsert('player_path', p)
  }
  if ('douban_uid' in b) {
    const uid = String(b.douban_uid || '').trim()
    if (uid && !/^\d{1,20}$/.test(uid)) {
      return res.status(400).json({ error: '豆瓣 UID 需为纯数字' })
    }
    upsert('douban_uid', uid)
  }
  if ('watch_enabled' in b) {
    upsert('watch_enabled', b.watch_enabled === false || b.watch_enabled === '0' ? '0' : '1')
    // 立即生效：重载文件夹监听
    const { startWatcher } = await import('../watcher.js')
    startWatcher()
  }
  res.json(getSettings())
})
