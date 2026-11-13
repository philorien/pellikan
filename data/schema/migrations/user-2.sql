-- user.db schema 1 -> 2: the imported-library tables change shape.
--   documents.stored_path becomes nullable (the app no longer keeps a copy of the original file in v1), and
--   doc_refs gains a `confidence` column ('high' or 'medium').
-- SQLite cannot drop a NOT NULL constraint, so the library tables are dropped and user.sql recreates them. That is safe
-- only because nothing could write to them under schema 1 (there were no statements for it). The caller (init_user in
-- src-tauri/src/db.rs, open() in server/utils/userDb.ts) checks that `documents` is empty first and refuses otherwise.
-- Notes, highlights, bookmarks and settings are not touched.

DROP TRIGGER IF EXISTS doc_chunks_ai;
DROP TRIGGER IF EXISTS doc_chunks_ad;
DROP TRIGGER IF EXISTS doc_chunks_au;
DROP TABLE IF EXISTS doc_refs;
DROP TABLE IF EXISTS doc_chunks_fts;
DROP TABLE IF EXISTS doc_chunks;
DROP TABLE IF EXISTS documents;
UPDATE schema_info SET value = '2' WHERE key = 'schema_version';
