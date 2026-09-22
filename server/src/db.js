import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { buildSearchText } from './search.js'
import { parseQuality } from './quality.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const DATA_DIR = process.env.MC_DATA_DIR || path.resolve(__dirname, '../data')
export const COVERS_DIR = path.join(DATA_DIR, 'covers')
export const PERSONS_DIR = path.join(DATA_DIR, 'persons')
fs.mkdirSync(COVERS_DIR, { recursive: true })
fs.mkdirSync(PERSONS_DIR, { recursive: true })

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
    country TEXT NOT NULL DEFAULT '',
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
    original_title TEXT NOT NULL DEFAULT '',
    search_text TEXT NOT NULL DEFAULT '',
    last_watched_at TEXT,
    collection_id INTEGER,
    collection_name TEXT NOT NULL DEFAULT '',
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

  CREATE TABLE IF NOT EXISTS rating_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    movie_id INTEGER NOT NULL REFERENCES movie(id) ON DELETE CASCADE,
    rating REAL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_movie_category ON movie(category);
  CREATE INDEX IF NOT EXISTS idx_movie_missing ON movie(missing);
  CREATE INDEX IF NOT EXISTS idx_movie_year ON movie(year);
  CREATE INDEX IF NOT EXISTS idx_movie_created ON movie(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_movie_tag_tag ON movie_tag(tag_id);
  CREATE INDEX IF NOT EXISTS idx_rating_history_movie ON rating_history(movie_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS person (
    tmdb_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    profile_path TEXT NOT NULL DEFAULT '',
    photo TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS douban_top250 (
    rank INTEGER PRIMARY KEY,
    douban_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    original_title TEXT NOT NULL DEFAULT '',
    year INTEGER,
    rating REAL
  );
`)

const movieCols = db.prepare('PRAGMA table_info(movie)').all().map(c => c.name)
if (!movieCols.includes('my_rating')) db.exec('ALTER TABLE movie ADD COLUMN my_rating REAL')
if (!movieCols.includes('watched')) db.exec('ALTER TABLE movie ADD COLUMN watched INTEGER NOT NULL DEFAULT 0')
if (!movieCols.includes('watch_count')) db.exec('ALTER TABLE movie ADD COLUMN watch_count INTEGER NOT NULL DEFAULT 0')
if (!movieCols.includes('original_title')) db.exec('ALTER TABLE movie ADD COLUMN original_title TEXT NOT NULL DEFAULT ""')
if (!movieCols.includes('douban_rank')) db.exec('ALTER TABLE movie ADD COLUMN douban_rank INTEGER')
if (!movieCols.includes('douban_id')) db.exec('ALTER TABLE movie ADD COLUMN douban_id TEXT')
if (!movieCols.includes('douban_rating')) db.exec('ALTER TABLE movie ADD COLUMN douban_rating REAL')
if (!movieCols.includes('search_text')) db.exec("ALTER TABLE movie ADD COLUMN search_text TEXT NOT NULL DEFAULT ''")
if (!movieCols.includes('last_watched_at')) db.exec('ALTER TABLE movie ADD COLUMN last_watched_at TEXT')
if (!movieCols.includes('collection_id')) db.exec('ALTER TABLE movie ADD COLUMN collection_id INTEGER')
if (!movieCols.includes('collection_name')) db.exec("ALTER TABLE movie ADD COLUMN collection_name TEXT NOT NULL DEFAULT ''")
if (!movieCols.includes('country')) db.exec("ALTER TABLE movie ADD COLUMN country TEXT NOT NULL DEFAULT ''")
if (!movieCols.includes('quality')) db.exec("ALTER TABLE movie ADD COLUMN quality TEXT NOT NULL DEFAULT ''")
db.exec('CREATE INDEX IF NOT EXISTS idx_movie_douban ON movie(douban_id)')
db.exec('CREATE INDEX IF NOT EXISTS idx_movie_collection ON movie(collection_id)')

const personCols = db.prepare('PRAGMA table_info(person)').all().map(c => c.name)
if (!personCols.includes('biography')) db.exec("ALTER TABLE person ADD COLUMN biography TEXT NOT NULL DEFAULT ''")
if (!personCols.includes('birthday')) db.exec("ALTER TABLE person ADD COLUMN birthday TEXT NOT NULL DEFAULT ''")
if (!personCols.includes('place_of_birth')) db.exec("ALTER TABLE person ADD COLUMN place_of_birth TEXT NOT NULL DEFAULT ''")
if (!personCols.includes('known_for')) db.exec("ALTER TABLE person ADD COLUMN known_for TEXT NOT NULL DEFAULT ''")
if (!personCols.includes('credits_json')) db.exec("ALTER TABLE person ADD COLUMN credits_json TEXT NOT NULL DEFAULT ''")
if (!personCols.includes('detail_at')) db.exec("ALTER TABLE person ADD COLUMN detail_at TEXT")

const missingSearchText = db.prepare(
  "SELECT id, title, original_title FROM movie WHERE search_text = ''"
).all()
if (missingSearchText.length) {
  const upd = db.prepare('UPDATE movie SET search_text = ? WHERE id = ?')
  db.exec('BEGIN')
  for (const r of missingSearchText) {
    upd.run(buildSearchText(r.title, r.original_title), r.id)
  }
  db.exec('COMMIT')
}

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

const missingQuality = db.prepare(
  "SELECT id, title, path, video_file FROM movie WHERE quality = ''"
).all()
if (missingQuality.length) {
  const upd = db.prepare('UPDATE movie SET quality = ? WHERE id = ?')
  db.exec('BEGIN')
  for (const r of missingQuality) {
    const videoName = String(r.video_file || '').split(/[\\/]/).pop()
    const folder = String(r.path || '').split(/[\\/]/).pop()
    upd.run(parseQuality(r.title, folder, videoName), r.id)
  }
  db.exec('COMMIT')
}

// ---------- 观影日记 ----------
// 每次观看记录一行（含历史种子），用于时间线与年度报告
db.exec(`
  CREATE TABLE IF NOT EXISTS watch_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    movie_id INTEGER NOT NULL REFERENCES movie(id) ON DELETE CASCADE,
    watched_at TEXT NOT NULL,
    rating REAL,
    note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'watch',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_watch_log_movie ON watch_log(movie_id, watched_at DESC);
  CREATE INDEX IF NOT EXISTS idx_watch_log_time ON watch_log(watched_at DESC);
`)

// 历史观看记录迁移为日记条目（仅首次运行一次）
const diarySeeded = db.prepare("SELECT value FROM settings WHERE \"key\" = 'watch_log_seeded'").get()
if (!diarySeeded) {
  const rows = db.prepare('SELECT id, last_watched_at, updated_at, my_rating FROM movie WHERE watched = 1').all()
  if (rows.length) {
    const ins = db.prepare(
      'INSERT INTO watch_log (movie_id, watched_at, rating, note, source, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    db.exec('BEGIN')
    for (const r of rows) {
      const at = r.last_watched_at
        || (r.updated_at ? r.updated_at.replace(' ', 'T').replace(/Z+$/, '') + 'Z' : null)
      if (!at) continue
      ins.run(r.id, at, r.my_rating ?? null, '历史观看记录导入', 'seed', at)
    }
    db.exec('COMMIT')
  }
  db.prepare("INSERT INTO settings (\"key\", value) VALUES ('watch_log_seeded', '1') ON CONFLICT(\"key\") DO NOTHING").run()
}

// ---------- 想看清单 ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS wishlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    original_title TEXT NOT NULL DEFAULT '',
    year INTEGER,
    douban_id TEXT,
    tmdb_id INTEGER,
    poster TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'wanted',
    movie_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_wishlist_status ON wishlist(status);
  CREATE INDEX IF NOT EXISTS idx_wishlist_douban ON wishlist(douban_id);
`)

const wishlistCols = db.prepare('PRAGMA table_info(wishlist)').all().map(c => c.name)
if (!wishlistCols.includes('douban_rating')) db.exec('ALTER TABLE wishlist ADD COLUMN douban_rating REAL')

// ---------- 自定义片单 ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS playlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    cover TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS playlist_movie (
    playlist_id INTEGER NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
    movie_id INTEGER NOT NULL REFERENCES movie(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (playlist_id, movie_id)
  );
  CREATE INDEX IF NOT EXISTS idx_playlist_movie_playlist ON playlist_movie(playlist_id, sort);
`)

// ---------- 增量扫描缓存（目录签名） ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS scan_cache (
    path TEXT PRIMARY KEY COLLATE NOCASE,
    sig TEXT NOT NULL
  );
`)
