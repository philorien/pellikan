-- Removes a document with its chunks, search entries and references (ON DELETE CASCADE, and the FTS trigger).
DELETE FROM documents WHERE id = :id
