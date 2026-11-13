-- Starts an import. The document stays 'processing', invisible to references and search, until document_finish.
INSERT INTO documents (title, author, format, original_name, sha256, stored_path, status)
VALUES (:title, :author, :format, :original_name, :sha256, NULL, 'processing')
RETURNING id
