-- One highlight per verse: setting a colour on a highlighted verse replaces it.
INSERT INTO highlights (book_id, chapter, verse, color)
VALUES (:book, :chapter, :verse, :color)
ON CONFLICT (book_id, chapter, verse) DO UPDATE SET color = excluded.color
