-- How many passages in finished imports match :q (see doc_search.sql).
SELECT count(*) AS total
FROM doc_chunks_fts
JOIN doc_chunks k ON k.id = doc_chunks_fts.rowid
JOIN documents d ON d.id = k.document_id
WHERE doc_chunks_fts MATCH :q AND d.status = 'ready'
