async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  let data = null
  try { data = await res.json() } catch {}
  if (!res.ok) throw new Error(data?.error || `请求失败 (${res.status})`)
  return data
}

function toQuery(params) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue
    q.set(k, Array.isArray(v) ? v.join(',') : String(v))
  }
  return q.toString()
}

export const api = {
  movies: (params = {}) => request('GET', '/api/movies?' + toQuery(params)),
  movie: id => request('GET', `/api/movies/${id}`),
  movieRatings: id => request('GET', `/api/movies/${id}/ratings`),
  updateRatingNote: (id, rid, note) => request('PUT', `/api/movies/${id}/ratings/${rid}`, { note }),
  removeRating: (id, rid) => request('DELETE', `/api/movies/${id}/ratings/${rid}`),
  updateMovie: (id, data) => request('PUT', `/api/movies/${id}`, data),
  watchMovie: id => request('POST', `/api/movies/${id}/watch`),
  playMovie: id => request('POST', `/api/movies/${id}/play`),
  detectPlayer: () => request('GET', '/api/player'),
  uploadCover: async (id, file) => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`/api/movies/${id}/cover`, { method: 'POST', body: fd })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.error || `上传失败 (${res.status})`)
    return data
  },
  removeCover: id => request('DELETE', `/api/movies/${id}/cover`),
  tags: () => request('GET', '/api/tags'),
  meta: () => request('GET', '/api/meta'),
  directors: (params = {}) => request('GET', '/api/meta/directors?' + toQuery(params)),
  actors: (params = {}) => request('GET', '/api/meta/actors?' + toQuery(params)),
  personPhotos: names => request('POST', '/api/person/photos', { names }),
  scanPaths: () => request('GET', '/api/scan/paths'),
  detectScanPaths: () => request('POST', '/api/scan/detect'),
  addScanPath: path => request('POST', '/api/scan/paths', { path }),
  removeScanPath: id => request('DELETE', `/api/scan/paths/${id}`),
  triggerScan: () => request('POST', '/api/scan'),
  scanStatus: () => request('GET', '/api/scan/status'),
  cleanupMissing: () => request('DELETE', '/api/scan/missing'),
  settings: () => request('GET', '/api/settings'),
  saveSettings: data => request('PUT', '/api/settings', data),
  scrapeMovie: (id, tmdbId, imdbId) => request('POST', `/api/scrape/${id}`, tmdbId ? { tmdbId } : imdbId ? { imdbId } : {}),
  scrapeSearch: (query, year) => request('POST', '/api/scrape/search', { query, year: year || null }),
  scrapeBatch: () => request('POST', '/api/scrape/batch'),
  scrapeBatchStatus: () => request('GET', '/api/scrape/batch/status'),
  testScrape: () => request('GET', '/api/scrape/test'),
  doubanTop250: () => request('GET', '/api/douban/top250'),
  doubanRefresh: () => request('POST', '/api/douban/refresh'),
  doubanSyncRatings: () => request('POST', '/api/douban/ratings'),
  doubanSyncStatus: () => request('GET', '/api/douban/ratings'),
  movieRows: () => request('GET', '/api/movies/rows'),
  pickMovie: (params = {}) => request('GET', '/api/movies/pick?' + toQuery(params)),
  dailyMovie: () => request('GET', '/api/movies/daily'),
  personDetail: name => request('GET', '/api/person/detail?name=' + encodeURIComponent(name)),
  duplicates: () => request('GET', '/api/movies/duplicates'),
  stats: () => request('GET', '/api/stats'),
  collections: () => request('GET', '/api/collections'),
  collection: id => request('GET', `/api/collections/${id}`),
  backupInfo: () => request('GET', '/api/system/backup'),
  backupNow: () => request('POST', '/api/system/backup'),
  autostartStatus: () => request('GET', '/api/system/autostart'),
  setAutostart: enabled => request('POST', '/api/system/autostart', { enabled }),
  // 观影日记
  diary: (params = {}) => request('GET', '/api/diary?' + toQuery(params)),
  diaryReport: year => request('GET', '/api/diary/report' + (year ? `?year=${year}` : '')),
  updateDiaryNote: (id, note) => request('PUT', `/api/diary/${id}`, { note }),
  removeDiary: id => request('DELETE', `/api/diary/${id}`),
  // 推荐
  similarMovies: id => request('GET', `/api/recommend/similar/${id}`),
  tasteProfile: () => request('GET', '/api/recommend/taste'),
  pickByTaste: () => request('POST', '/api/recommend/pick-by-taste'),
  // 想看清单
  wishlist: status => request('GET', '/api/wishlist' + (status ? `?status=${status}` : '')),
  importWishlist: text => request('POST', '/api/wishlist/import', { text }),
  matchWishlist: () => request('POST', '/api/wishlist/match'),
  matchWishlistItem: (id, movieId) => request('POST', `/api/wishlist/${id}/match`, { movie_id: movieId }),
  enrichWishlist: limit => request('POST', '/api/wishlist/enrich', { limit }),
  setWishlistStatus: (id, status) => request('PUT', `/api/wishlist/${id}`, { status }),
  removeWishlistItem: id => request('DELETE', `/api/wishlist/${id}`),
  doubanWishlistSync: uid => request('POST', '/api/wishlist/sync-douban', uid ? { uid } : {}),
  doubanWishlistSyncStatus: () => request('GET', '/api/wishlist/sync-douban'),
  // NFO
  exportNfo: id => request('POST', `/api/nfo/${id}`),
  exportNfoAll: () => request('POST', '/api/nfo'),
  previewNfo: id => request('GET', `/api/nfo/${id}/preview`),
  // 画质重识别
  reprobeQuality: id => request('POST', `/api/movies/${id}/reprobe`),
  // 扫描
  triggerScanFull: () => request('POST', '/api/scan', { forceFull: true })
}
