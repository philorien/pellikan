-- Passages in imported books that cite one verse: a reference whose range covers :verse in :book :chapter.
-- One row per passage, even if it cites the verse twice. `confidence` is the strongest of its matching references:
-- 'high' (a written chapter and verse) sorts before 'medium' (a chapter alone, or a "v. 5" resolved from context).
-- Only finished imports count, so a book that is still importing never shows half its references.
SELECT k.id AS chunk_id, d.id AS document_id, d.title, d.author, k.heading, k.loc, k.text,
       CASE min(CASE r.confidence WHEN 'high' THEN 0 ELSE 1 END) WHEN 0 THEN 'high' ELSE 'medium' END AS confidence
FROM doc_refs r
JOIN doc_chunks k ON k.id = r.chunk_id
JOIN documents d ON d.id = k.document_id
WHERE r.book_id = :book AND r.chapter = :chapter AND r.verse_start <= :verse AND r.verse_end >= :verse
  AND d.status = 'ready'
GROUP BY k.id
ORDER BY min(CASE r.confidence WHEN 'high' THEN 0 ELSE 1 END), d.title, k.seq
LIMIT :limit
