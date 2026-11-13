-- Adds a note on one verse. :at is milliseconds since the epoch, so notes moved in from localStorage keep their date.
INSERT INTO notes (book_id, chapter, verse_start, verse_end, body, created_at, updated_at)
VALUES (:book, :chapter, :verse, :verse, :body, datetime(:at / 1000, 'unixepoch'), datetime(:at / 1000, 'unixepoch'))
RETURNING id
