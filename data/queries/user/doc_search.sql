-- Full-text search over imported books. :q must come from toFtsQuery() in shared/text.ts (every term quoted).
-- snippet() marks hits with control characters 0x02 / 0x03 instead of HTML, like search_verses, so the UI can
-- highlight without v-html. Column -1 lets a hit in the heading show up too. `text` is the whole passage, for
-- "show the passage". Only finished imports are searched.
SELECT k.id AS chunk_id, d.id AS document_id, d.title, d.author, k.heading, k.loc, k.text,
       snippet(doc_chunks_fts, -1, char(2), char(3), '…', 24) AS snippet
FROM doc_chunks_fts
JOIN doc_chunks k ON k.id = doc_chunks_fts.rowid
JOIN documents d ON d.id = k.document_id
WHERE doc_chunks_fts MATCH :q AND d.status = 'ready'
ORDER BY bm25(doc_chunks_fts), d.title, k.seq
LIMIT :limit OFFSET :offset
