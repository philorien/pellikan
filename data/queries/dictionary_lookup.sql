-- Dictionary headwords that start with :prefix (already lower-cased and accent-folded by the caller).
-- A range over the headword_norm index, not substr(), so SQLite can seek instead of scanning every entry.
SELECT d.id, d.source_id, d.headword, substr(d.body, 1, 160) AS preview
FROM dictionary_entries d
WHERE d.headword_norm >= :prefix AND d.headword_norm < :prefix || char(65535)
ORDER BY d.headword_norm, d.source_id
LIMIT :limit
