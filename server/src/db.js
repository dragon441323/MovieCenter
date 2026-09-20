import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const DATA_DIR = process.env.MC_DATA_DIR || path.resolve(__dirname, '../data')
export const COVERS_DIR = path.join(DATA_DIR, 'covers')
fs.mkdirSync(COVERS_DIR, { recursive: true })

export const db = new DatabaseSync(path.join(DATA_DIR, 'moviecenter.db'))

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS scan_path (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE COLLATE NOCASE,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    "key" TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS movie (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    year INTEGER,
    synopsis TEXT NOT NULL DEFAULT '',
    director TEXT NOT NULL DEFAULT '',
    actors TEXT NOT NULL DEFAULT '[]',
    category TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL UNIQUE COLLATE NOCASE,
    video_file TEXT NOT NULL DEFAULT '',
    file_size INTEGER NOT NULL DEFAULT 0,
    cover TEXT NOT NULL DEFAULT '',
    rating REAL,
    favorite INTEGER NOT NULL DEFAULT 0,
    my_rating REAL,
    watched INTEGER NOT NULL DEFAULT 0,
    watch_count INTEGER NOT NULL DEFAULT 0,
    tmdb_id INTEGER,
    missing INTEGER NOT NULL DEFAULT 0,
    last_scan_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tag (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );

  CREATE TABLE IF NOT EXISTS movie_tag (
    movie_id INTEGER NOT NULL REFERENCES movie(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
    PRIMARY KEY (movie_id, tag_id)
  );

  CREATE INDEX IF NOT EXISTS idx_movie_category ON movie(category);
  CREATE INDEX IF NOT EXISTS idx_movie_missing ON movie(missing);
  CREATE INDEX IF NOT EXISTS idx_movie_year ON movie(year);
  CREATE INDEX IF NOT EXISTS idx_movie_created ON movie(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_movie_tag_tag ON movie_tag(tag_id);
`)

const movieCols = db.prepare('PRAGMA table_info(movie)').all().map(c => c.name)
if (!movieCols.includes('my_rating')) db.exec('ALTER TABLE movie ADD COLUMN my_rating REAL')
if (!movieCols.includes('watched')) db.exec('ALTER TABLE movie ADD COLUMN watched INTEGER NOT NULL DEFAULT 0')
if (!movieCols.includes('watch_count')) db.exec('ALTER TABLE movie ADD COLUMN watch_count INTEGER NOT NULL DEFAULT 0')

const legacyCategories = db.prepare(
  "SELECT id, category FROM movie WHERE category != '' AND category NOT LIKE '[%'"
).all()
if (legacyCategories.length) {
  const upd = db.prepare('UPDATE movie SET category = ? WHERE id = ?')
  db.exec('BEGIN')
  for (const r of legacyCategories) {
    const arr = r.category.split('/').map(s => s.trim()).filter(Boolean)
    upd.run(JSON.stringify(arr), r.id)
  }
  db.exec('COMMIT')
}
