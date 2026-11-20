-- Every bookmark, newest first. `at` is milliseconds since the epoch.
SELECT id, book_id, chapter, verse, label, CAST(strftime('%s', created_at) AS INTEGER) * 1000 AS at
FROM bookmarks
ORDER BY created_at DESC, id DESC
