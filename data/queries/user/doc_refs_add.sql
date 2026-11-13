-- Adds the references for a batch of chunks already added with doc_chunks_add. :chunks is the same JSON array, with
-- each chunk's `refs`: [{book, chapter, from, to, confidence}]. Chunks are found by (document, seq).
INSERT INTO doc_refs (chunk_id, book_id, chapter, verse_start, verse_end, confidence)
SELECT k.id, json_extract(r.value, '$.book'), json_extract(r.value, '$.chapter'), json_extract(r.value, '$.from'),
       json_extract(r.value, '$.to'), json_extract(r.value, '$.confidence')
FROM json_each(:chunks) AS c, doc_chunks AS k, json_each(c.value, '$.refs') AS r
WHERE k.document_id = :document AND k.seq = json_extract(c.value, '$.seq')
-- Only a repeated reference is skipped. A bad value (a missing or unknown confidence, a null book) is an error, not a silent gap.
ON CONFLICT DO NOTHING
