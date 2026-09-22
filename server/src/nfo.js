// NFO 导出：将刮削结果写回影片文件夹（Kodi / Emby / Jellyfin 兼容格式）
import fs from 'node:fs/promises'
import path from 'node:path'
import { db } from './db.js'
import { parseCategories, serializeMovie } from './routes/movies.js'

function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function tag(name, value, attrs = '') {
  if (value === undefined || value === null || value === '') return ''
  return `  <${name}${attrs}>${xmlEscape(value)}</${name}>\n`
}

/** 生成 Kodi 风格 movie.nfo 内容。 */
export function buildMovieNfo(movie) {
  const m = serializeMovie(movie)
  const lines = []
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n')
  lines.push('<movie>\n')
  lines.push(tag('title', m.title))
  lines.push(tag('originaltitle', m.original_title))
  lines.push(tag('sorttitle', m.title))
  lines.push(tag('year', m.year))
  if (m.tmdb_id) {
    lines.push(`  <uniqueid type="tmdb" default="true">${m.tmdb_id}</uniqueid>\n`)
  }
  if (m.douban_id) {
    lines.push(`  <uniqueid type="douban">${xmlEscape(m.douban_id)}</uniqueid>\n`)
  }
  lines.push(tag('rating', m.rating != null ? Number(m.rating).toFixed(1) : '', ' max="10" default="true" name="tmdb"'))
  if (m.douban_rating != null) {
    lines.push(`  <rating max="10" name="douban">\n    <value>${m.douban_rating.toFixed(1)}</value>\n    <votes>0</votes>\n  </rating>\n`)
  }
  if (m.my_rating != null) {
    lines.push(`  <userrating max="10">${m.my_rating.toFixed(1)}</userrating>\n`)
  }
  lines.push(tag('top250', m.douban_rank))
  lines.push(tag('outline', (m.synopsis || '').slice(0, 200)))
  lines.push(tag('plot', m.synopsis))
  lines.push(tag('director', m.director))
  for (const a of (m.actors || []).slice(0, 10)) {
    lines.push(`  <actor>\n    <name>${xmlEscape(a)}</name>\n  </actor>\n`)
  }
  for (const c of (m.categories || [])) {
    lines.push(tag('genre', c))
  }
  for (const c of (m.countries || [])) {
    lines.push(tag('country', c))
  }
  for (const t of (m.tags || [])) {
    lines.push(tag('tag', t.name))
  }
  lines.push(tag('trailer', ''))
  if (m.cover) {
    lines.push(`  <thumb aspect="poster">${xmlEscape('//' + m.cover)}</thumb>\n`)
  }
  lines.push('</movie>\n')
  return lines.join('')
}

/** 将 NFO 写入影片所在文件夹（同名 movie.nfo；文件夹无写权限时报错）。 */
export async function writeNfoForMovie(movieId) {
  const movie = db.prepare('SELECT * FROM movie WHERE id = ?').get(movieId)
  if (!movie) {
    const err = new Error('电影不存在')
    err.status = 404
    throw err
  }
  if (movie.missing) {
    const err = new Error('文件已缺失，无法导出')
    err.status = 400
    throw err
  }
  const dir = path.dirname(movie.video_file || movie.path)
  const file = path.join(dir, 'movie.nfo')
  const content = buildMovieNfo(movie)
  await fs.writeFile(file, content, 'utf8')
  return { file, bytes: Buffer.byteLength(content) }
}

/** 批量导出：为所有 missing=0 且信息完整（有标题）的影片写 NFO。 */
export async function writeNfoAll() {
  const movies = db.prepare('SELECT * FROM movie WHERE missing = 0').all()
  let written = 0, failed = 0
  const errors = []
  for (const m of movies) {
    try {
      await writeNfoForMovie(m.id)
      written++
    } catch (err) {
      failed++
      if (errors.length < 30) errors.push(`${m.title}: ${err.message}`)
    }
  }
  return { total: movies.length, written, failed, errors }
}

/** 预览 NFO 内容（不写盘）。 */
export function previewNfo(movieId) {
  const movie = db.prepare('SELECT * FROM movie WHERE id = ?').get(movieId)
  if (!movie) {
    const err = new Error('电影不存在')
    err.status = 404
    throw err
  }
  return buildMovieNfo(movie)
}
