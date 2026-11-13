-- Pellikan user database (read/write). Created on first launch in the app data directory.
-- Idempotent: safe to run on every start. Needs PRAGMA foreign_keys = ON on the connection.
--
-- Not stored here on purpose: AI provider API keys. Those belong in the OS keychain
-- (macOS Keychain / Windows Credential Manager / Secret Service), never in a database file.
--
-- Schema version: 2 (see data/schema/migrations/ for how an older file is brought forward)

CREATE TABLE IF NOT EXISTS schema_info (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
INSERT OR IGNORE INTO schema_info (key, value) VALUES ('schema_version', '2');

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

-- References use the canonical book ids from the reference DB (1..66) and English numbering.

CREATE TABLE IF NOT EXISTS notes (
  id          INTEGER PRIMARY KEY,
  book_id     INTEGER NOT NULL,
  chapter     INTEGER NOT NULL,
  verse_start INTEGER NOT NULL,
  verse_end   INTEGER NOT NULL,
  body        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS notes_ref ON notes (book_id, chapter, verse_start);

CREATE TABLE IF NOT EXISTS highlights (
  id         INTEGER PRIMARY KEY,
  book_id    INTEGER NOT NULL,
  chapter    INTEGER NOT NULL,
  verse      INTEGER NOT NULL,
  color      TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (book_id, chapter, verse)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id         INTEGER PRIMARY KEY,
  book_id    INTEGER NOT NULL,
  chapter    INTEGER NOT NULL,
  verse      INTEGER NOT NULL DEFAULT 1,
  label      TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (book_id, chapter, verse)
);

-- ---------------------------------------------------------------------------------------------
-- Imported library. Formats the schema allows: epub, pdf, docx, txt, md, html. The app imports txt and md so far.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS documents (
  id              INTEGER PRIMARY KEY,
  title           TEXT NOT NULL,
  author          TEXT,
  format          TEXT NOT NULL CHECK (format IN ('epub', 'pdf', 'docx', 'txt', 'md', 'html')),
  original_name   TEXT NOT NULL,
  sha256          TEXT NOT NULL UNIQUE,         -- of the file's bytes: importing the same file twice is a no-op
  stored_path     TEXT,                         -- NULL: the original file is not kept, only the extracted text
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  error           TEXT,                         -- shown to the user when extraction fails (e.g. scanned PDF, no text layer)
  extracted_chars INTEGER,
  imported_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Extracted text split into passages of a few paragraphs. This is the unit that gets searched,
-- cited, and (if the user opts in) sent to an AI provider.
CREATE TABLE IF NOT EXISTS doc_chunks (
  id          INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  heading     TEXT,                             -- chapter / section title when the format provides one
  loc         TEXT,                             -- human location: 'Ch. 3', 'p. 112'
  text        TEXT    NOT NULL,
  UNIQUE (document_id, seq)
);

CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunks_fts USING fts5 (
  text,
  heading,
  content = 'doc_chunks',
  content_rowid = 'id',
  tokenize = 'porter unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS doc_chunks_ai AFTER INSERT ON doc_chunks BEGIN
  INSERT INTO doc_chunks_fts (rowid, text, heading) VALUES (new.id, new.text, new.heading);
END;
CREATE TRIGGER IF NOT EXISTS doc_chunks_ad AFTER DELETE ON doc_chunks BEGIN
  INSERT INTO doc_chunks_fts (doc_chunks_fts, rowid, text, heading) VALUES ('delete', old.id, old.text, old.heading);
END;
CREATE TRIGGER IF NOT EXISTS doc_chunks_au AFTER UPDATE ON doc_chunks BEGIN
  INSERT INTO doc_chunks_fts (doc_chunks_fts, rowid, text, heading) VALUES ('delete', old.id, old.text, old.heading);
  INSERT INTO doc_chunks_fts (rowid, text, heading) VALUES (new.id, new.text, new.heading);
END;

-- Scripture references detected inside imported documents (see shared/reference-scan.ts).
-- This is what lets the reader show "passages in your library that cite Romans 8:28".
-- One row per chapter: "Gen 1:1-2:3" is stored as Gen 1:1-31 and Gen 2:1-3. `confidence` is the scanner's: 'high' for a
-- written chapter and verse, 'medium' for a chapter alone and for "v. 5" resolved from context.
CREATE TABLE IF NOT EXISTS doc_refs (
  chunk_id    INTEGER NOT NULL REFERENCES doc_chunks (id) ON DELETE CASCADE,
  book_id     INTEGER NOT NULL,
  chapter     INTEGER NOT NULL,
  verse_start INTEGER NOT NULL,
  verse_end   INTEGER NOT NULL,
  confidence  TEXT    NOT NULL DEFAULT 'high' CHECK (confidence IN ('high', 'medium')),
  PRIMARY KEY (chunk_id, book_id, chapter, verse_start, verse_end)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS doc_refs_ref ON doc_refs (book_id, chapter, verse_start);
