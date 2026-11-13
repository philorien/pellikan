-- The document already imported from a file with this SHA-256, if any.
SELECT id, title, status FROM documents WHERE sha256 = :sha256
