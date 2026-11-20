-- One bookmark per verse. Bookmarking a verse that is already bookmarked only changes its label (NULL for none).
-- A bookmark on a whole chapter is stored as verse 1.
INSERT INTO bookmarks (book_id, chapter, verse, label)
VALUES (:book, :chapter, :verse, :label)
ON CONFLICT (book_id, chapter, verse) DO UPDATE SET label = excluded.label
RETURNING id, CAST(strftime('%s', created_at) AS INTEGER) * 1000 AS at
