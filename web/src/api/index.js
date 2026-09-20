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
  updateMovie: (id, data) => request('PUT', `/api/movies/${id}`, data),
  watchMovie: id => request('POST', `/api/movies/${id}/watch`),
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
  scanPaths: () => request('GET', '/api/scan/paths'),
  detectScanPaths: () => request('POST', '/api/scan/detect'),
  addScanPath: path => request('POST', '/api/scan/paths', { path }),
  removeScanPath: id => request('DELETE', `/api/scan/paths/${id}`),
  triggerScan: () => request('POST', '/api/scan'),
  scanStatus: () => request('GET', '/api/scan/status'),
  settings: () => request('GET', '/api/settings'),
  saveSettings: data => request('PUT', '/api/settings', data),
  scrapeMovie: (id, tmdbId) => request('POST', `/api/scrape/${id}`, tmdbId ? { tmdbId } : {}),
  scrapeBatch: () => request('POST', '/api/scrape/batch'),
  scrapeBatchStatus: () => request('GET', '/api/scrape/batch/status'),
  testScrape: () => request('GET', '/api/scrape/test')
}
