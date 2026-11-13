-- Every note, newest first. `at` is milliseconds since the epoch (created_at is stored as UTC text, to the second).
SELECT id, book_id, chapter, verse_start AS verse, body,
       CAST(strftime('%s', created_at) AS INTEGER) * 1000 AS at
FROM notes
ORDER BY created_at DESC, id DESC
