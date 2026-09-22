import { pinyin } from 'pinyin-pro'

function compact(text) {
  return String(text || '').replace(/\s+/g, '')
}

export function buildSearchText(title, originalTitle = '') {
  const t = String(title || '').trim()
  if (!t) return ''
  let full = ''
  let initials = ''
  try {
    full = compact(pinyin(t, { toneType: 'none', type: 'string', nonZh: 'consecutive' }))
    initials = compact(pinyin(t, { pattern: 'first', toneType: 'none', type: 'string', nonZh: 'consecutive' }))
  } catch {}
  return [t.toLowerCase(), String(originalTitle || '').trim().toLowerCase(), full, initials]
    .filter(Boolean)
    .join(' ')
}
