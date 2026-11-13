-- Every imported document with how many passages and Scripture references it holds, newest first.
SELECT d.id, d.title, d.author, d.format, d.original_name, d.status, d.error, d.extracted_chars,
       CAST(strftime('%s', d.imported_at) AS INTEGER) * 1000 AS at,
       (SELECT count(*) FROM doc_chunks c WHERE c.document_id = d.id) AS chunks,
       (SELECT count(*) FROM doc_refs r JOIN doc_chunks c ON c.id = r.chunk_id WHERE c.document_id = d.id) AS refs
FROM documents d
ORDER BY d.imported_at DESC, d.id DESC
