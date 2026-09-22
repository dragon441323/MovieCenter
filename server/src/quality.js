// 从文件夹名 / 视频文件名解析画质标签
const RULES = [
  [/(^|[^0-9a-z])4320p?([^0-9a-z]|$)/i, '8K'],
  [/(^|[^0-9a-z])8k([^0-9a-z]|$)/i, '8K'],
  [/(^|[^0-9a-z])2160p?([^0-9a-z]|$)/i, '4K'],
  [/(^|[^0-9a-z])4k([^0-9a-z]|$)/i, '4K'],
  [/(^|[^0-9a-z])uhd([^0-9a-z]|$)/i, '4K'],
  [/1080[pi]/i, '1080p'],
  [/720[pi]/i, '720p'],
  [/480[pi]/i, '480p']
]

export function parseQuality(...sources) {
  const text = sources
    .filter(Boolean)
    .map(s => String(s))
    .join(' ')
  if (!text) return ''
  for (const [re, label] of RULES) {
    if (re.test(text)) return label
  }
  return ''
}
