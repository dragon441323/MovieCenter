import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { COVERS_DIR } from './db.js'

export async function saveCoverBuffer(movieId, buffer) {
  const filename = `${movieId}_${Date.now()}.jpg`
  await sharp(buffer)
    .resize({ width: 600, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(path.join(COVERS_DIR, filename))
  return filename
}

export function removeCoverFile(filename) {
  if (!filename) return
  try { fs.unlinkSync(path.join(COVERS_DIR, filename)) } catch {}
}
