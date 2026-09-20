import { fetch as undiciFetch, ProxyAgent } from 'undici'
import { db } from './db.js'

const TMDB_BASE = process.env.MC_TMDB_BASE || 'https://api.themoviedb.org/3'
const TMDB_IMG_BASE = process.env.MC_TMDB_IMG_BASE || 'https://image.tmdb.org/t/p'

function getSetting(name, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE "key" = ?').get(name)
  return row?.value ?? fallback
}

export function getTmdbConfig() {
  return {
    apiKey: getSetting('tmdb_api_key'),
    language: getSetting('tmdb_language', 'zh-CN'),
    proxy: getSetting('tmdb_proxy')
  }
}

let proxyCache = { url: '', agent: null }

function getDispatcher() {
  const url = getTmdbConfig().proxy
  if (!url) return undefined
  if (proxyCache.url !== url || !proxyCache.agent) {
    try {
      proxyCache = { url, agent: new ProxyAgent(url) }
    } catch {
      const err = new Error(`代理地址无效: ${url}`)
      err.status = 400
      throw err
    }
  }
  return proxyCache.agent
}

function friendlyError(err) {
  if (err.name === 'AbortError') {
    const e = new Error('TMDB 请求超时，直连不通时请在设置中配置代理')
    e.status = 502
    return e
  }
  const code = err?.cause?.code
  if (code) {
    const e = new Error(`无法连接 TMDB (${code})，请检查网络或在设置中配置代理`)
    e.status = 502
    return e
  }
  if (err?.message === 'fetch failed') {
    const e = new Error('无法连接 TMDB，请检查网络或在设置中配置代理')
    e.status = 502
    return e
  }
  return err
}

export async function tmdbFetch(pathname, params = {}) {
  const { apiKey, language } = getTmdbConfig()
  if (!apiKey) {
    const err = new Error('未配置 TMDB API Key，请先在设置中填写')
    err.status = 400
    throw err
  }
  const url = new URL(TMDB_BASE + pathname)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  url.searchParams.set('language', language)
  url.searchParams.set('include_adult', 'false')
  const headers = { accept: 'application/json' }
  if (apiKey.startsWith('eyJ')) headers.Authorization = `Bearer ${apiKey}`
  else url.searchParams.set('api_key', apiKey)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await undiciFetch(url, { headers, signal: controller.signal, dispatcher: getDispatcher() })
    if (res.status === 401) throw new Error('TMDB API Key 无效（401）')
    if (res.status === 404) throw new Error('TMDB 中未找到该影片')
    if (!res.ok) throw new Error(`TMDB 请求失败 (${res.status})`)
    return await res.json()
  } catch (err) {
    throw friendlyError(err)
  } finally {
    clearTimeout(timer)
  }
}

export async function searchMovies(query, year) {
  const data = await tmdbFetch('/search/movie', {
    query,
    year: Number.isInteger(year) && year > 0 ? year : undefined
  })
  return data.results || []
}

export async function searchPerson(query) {
  const data = await tmdbFetch('/search/person', { query })
  return data.results || []
}

export async function findByExternalId(externalId, externalSource) {
  return tmdbFetch(`/find/${encodeURIComponent(externalId)}`, { external_source: externalSource })
}

export async function getMovieDetails(tmdbId) {
  return tmdbFetch(`/movie/${tmdbId}`, { append_to_response: 'credits' })
}

export function imageUrl(imagePath, size = 'w500') {
  return `${TMDB_IMG_BASE}/${size}${imagePath}`
}

export async function downloadImage(imagePath, size = 'w500') {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await undiciFetch(imageUrl(imagePath, size), { signal: controller.signal, dispatcher: getDispatcher() })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
