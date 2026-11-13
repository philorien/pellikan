-- Adds a batch of chunks. :chunks is a JSON array of {seq, heading, loc, text}; the whole batch goes in as one
-- parameter so that a book of thousands of chunks takes a few calls, not thousands.
INSERT INTO doc_chunks (document_id, seq, heading, loc, text)
SELECT :document, json_extract(c.value, '$.seq'), json_extract(c.value, '$.heading'), json_extract(c.value, '$.loc'), json_extract(c.value, '$.text')
FROM json_each(:chunks) AS c
