//! Named queries: read-only ones over the bundled reference database, and read/write ones over the user's own database.
//!
//! The UI never sends SQL. It sends a query *name* plus parameters, and the SQL comes from `data/queries/*.sql`
//! (reference database) or `data/queries/user/*.sql` (user database), compiled into the binary with `include_str!`.
//! The same files are used by the dev server (`nuxt dev`), so a query is written once. Anything not in `QUERIES` or
//! `USER_QUERIES` is rejected, and the two lists never cross: a user query cannot run on `bible.db` or the reverse.

use rusqlite::types::{ToSqlOutput, Value as SqlValue, ValueRef};
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{Map, Value};

macro_rules! q {
    ($name:literal) => {
        ($name, include_str!(concat!("../../data/queries/", $name, ".sql")))
    };
}

/// Every file in data/queries must be listed here (data/scripts/check-db.mjs fails if one is missing).
pub const QUERIES: &[(&str, &str)] = &[
    q!("books"),
    q!("chapter_headings"),
    q!("chapter_notes"),
    q!("chapter_verses"),
    q!("chapter_words"),
    q!("commentary_chapter"),
    q!("cross_refs"),
    q!("dictionary_entry"),
    q!("dictionary_lookup"),
    q!("dictionary_search"),
    q!("lemma_info"),
    q!("lexicon_for_strongs"),
    q!("occurrences_by_form"),
    q!("occurrences_by_key"),
    q!("occurrences_by_strongs"),
    q!("search_verses"),
    q!("search_verses_count"),
    q!("sources"),
];

macro_rules! uq {
    ($name:literal) => {
        ($name, include_str!(concat!("../../data/queries/user/", $name, ".sql")))
    };
}

/// Every file in data/queries/user must be listed here (check-db.mjs fails if one is missing). These run on user.db
/// only, and unlike `QUERIES` they include writes.
pub const USER_QUERIES: &[(&str, &str)] = &[
    uq!("doc_chunks_add"),
    uq!("doc_refs_add"),
    uq!("document_add"),
    uq!("document_by_hash"),
    uq!("document_fail"),
    uq!("document_finish"),
    uq!("document_remove"),
    uq!("documents_all"),
    uq!("documents_fail_stale"),
    uq!("highlight_remove"),
    uq!("highlight_set"),
    uq!("highlights_all"),
    uq!("note_add"),
    uq!("note_remove"),
    uq!("notes_all"),
    uq!("setting_set"),
    uq!("settings_all"),
];

/// One step of a `run_user_batch` call.
#[derive(Deserialize)]
pub struct Op {
    pub name: String,
    #[serde(default)]
    pub params: Map<String, Value>,
}

/// Sets the pragmas user.db relies on, brings an older file forward, and applies the schema. Idempotent: safe on every
/// launch (see data/schema/user.sql).
pub fn init_user(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;").map_err(|e| e.to_string())?;
    migrate_user(conn)?;
    conn.execute_batch(include_str!("../../data/schema/user.sql")).map_err(|e| format!("user.db schema: {e}"))
}

/// Schema 1 -> 2 (data/schema/migrations/user-2.sql): the imported-library tables are dropped so user.sql can create
/// them in their new shape. Refuses if any document is there, because it would be lost. Under schema 1 nothing could
/// write to those tables, so a real file never trips this. server/utils/userDb.ts does the same.
fn migrate_user(conn: &Connection) -> Result<(), String> {
    let has = |name: &str| -> Result<bool, String> {
        conn.query_row("SELECT count(*) FROM sqlite_master WHERE name = ?1", [name], |r| r.get::<_, i64>(0)).map(|n| n > 0).map_err(|e| e.to_string())
    };
    if !has("schema_info")? {
        return Ok(()); // a new file: user.sql creates everything at the current version
    }
    let version: Option<String> = conn
        .query_row("SELECT value FROM schema_info WHERE key = 'schema_version'", [], |r| r.get(0))
        .map(Some)
        .or_else(|e| if matches!(e, rusqlite::Error::QueryReturnedNoRows) { Ok(None) } else { Err(e) })
        .map_err(|e| e.to_string())?;
    if version.as_deref() != Some("1") {
        return Ok(());
    }
    if has("documents")? {
        let documents: i64 = conn.query_row("SELECT count(*) FROM documents", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        if documents > 0 {
            return Err(format!("user.db holds {documents} imported document(s) in schema 1, which cannot be upgraded automatically"));
        }
    }
    conn.execute_batch(&format!("BEGIN; {} COMMIT;", include_str!("../../data/schema/migrations/user-2.sql")))
        .or_else(|e| {
            let _ = conn.execute_batch("ROLLBACK");
            Err(format!("user.db migration to schema 2: {e}"))
        })
}

fn bind_value(v: &Value, key: &str) -> Result<ToSqlOutput<'static>, String> {
    match v {
        Value::Null => Ok(ToSqlOutput::Owned(SqlValue::Null)),
        Value::String(s) => Ok(ToSqlOutput::Owned(SqlValue::Text(s.clone()))),
        Value::Number(n) => match (n.as_i64(), n.as_f64()) {
            (Some(i), _) => Ok(ToSqlOutput::Owned(SqlValue::Integer(i))),
            (None, Some(f)) => Ok(ToSqlOutput::Owned(SqlValue::Real(f))),
            _ => Err(format!("Parameter \"{key}\" is not a usable number")),
        },
        _ => Err(format!("Parameter \"{key}\" must be a string, number or null")),
    }
}

fn cell(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => Value::from(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        // The reference database has no BLOB columns; surface a marker instead of silently dropping data.
        ValueRef::Blob(_) => Value::String("<blob>".into()),
    }
}

/// Runs one named query on the reference database and returns its rows as JSON objects keyed by column name.
pub fn run_named(conn: &Connection, name: &str, params: &Map<String, Value>) -> Result<Vec<Value>, String> {
    run_from(QUERIES, conn, name, params)
}

/// Runs one named statement on the user database. Writes return no rows unless the SQL has a RETURNING clause.
pub fn run_user(conn: &Connection, name: &str, params: &Map<String, Value>) -> Result<Vec<Value>, String> {
    run_from(USER_QUERIES, conn, name, params)
}

/// Runs several named statements on the user database in one transaction: all of them apply, or none do.
pub fn run_user_batch(conn: &mut Connection, ops: &[Op]) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for op in ops {
        run_from(USER_QUERIES, &tx, &op.name, &op.params)?;
    }
    tx.commit().map_err(|e| e.to_string())
}

fn run_from(queries: &[(&str, &str)], conn: &Connection, name: &str, params: &Map<String, Value>) -> Result<Vec<Value>, String> {
    let sql = queries
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, sql)| *sql)
        .ok_or_else(|| format!("Unknown query \"{name}\""))?;

    let mut stmt = conn.prepare(sql).map_err(|e| format!("{name}: {e}"))?;

    // Bind by the :names the SQL itself declares; a missing parameter is an error, never a silent NULL.
    for i in 1..=stmt.parameter_count() {
        let pname = stmt.parameter_name(i).ok_or_else(|| format!("{name}: positional parameters are not supported"))?;
        let key = pname.trim_start_matches([':', '@', '$']);
        let v = params.get(key).ok_or_else(|| format!("Missing parameter \"{key}\""))?;
        let bound = bind_value(v, key)?;
        stmt.raw_bind_parameter(i, bound).map_err(|e| format!("{name}: {e}"))?;
    }

    let cols: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
    let mut rows = stmt.raw_query();
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| format!("{name}: {e}"))? {
        let mut obj = Map::with_capacity(cols.len());
        for (i, c) in cols.iter().enumerate() {
            obj.insert(c.clone(), cell(row.get_ref(i).map_err(|e| format!("{name}: {e}"))?));
        }
        out.push(Value::Object(obj));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn params(v: Value) -> Map<String, Value> {
        v.as_object().cloned().unwrap_or_default()
    }

    /// The real database, if it has been built (`npm run data`). Tests that need it skip with a message otherwise.
    fn real_db() -> Option<Connection> {
        let path = std::env::var("PELLIKAN_DB").unwrap_or_else(|_| "../data/build/bible.db".into());
        match Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) {
            Ok(c) => Some(c),
            Err(_) => {
                eprintln!("skipped: {path} not found");
                None
            }
        }
    }

    /// A fresh user database, in memory, with the real schema.
    fn user_db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init_user(&c).unwrap();
        c
    }

    #[test]
    fn names_are_unique() {
        for list in [QUERIES, USER_QUERIES] {
            let mut names: Vec<_> = list.iter().map(|q| q.0).collect();
            names.sort();
            let n = names.len();
            names.dedup();
            assert_eq!(n, names.len());
        }
    }

    #[test]
    fn every_user_query_prepares_against_the_user_schema() {
        let c = user_db();
        init_user(&c).unwrap(); // the schema runs on every launch, so it has to apply twice
        for (name, sql) in USER_QUERIES {
            c.prepare(sql).unwrap_or_else(|e| panic!("{name}: {e}"));
        }
    }

    #[test]
    fn the_two_query_lists_do_not_cross() {
        let c = user_db();
        assert!(run_user(&c, "chapter_verses", &params(json!({}))).unwrap_err().contains("Unknown query"));
        assert!(run_named(&c, "note_add", &params(json!({}))).unwrap_err().contains("Unknown query"));
    }

    #[test]
    fn notes_round_trip() {
        let c = user_db();
        let at = 1_700_000_000_123_i64;
        let added = run_user(&c, "note_add", &params(json!({"book": 45, "chapter": 8, "verse": 28, "body": "All things", "at": at}))).unwrap();
        let id = added[0]["id"].as_i64().unwrap();
        run_user(&c, "note_add", &params(json!({"book": 43, "chapter": 3, "verse": 16, "body": "Later", "at": at + 5_000}))).unwrap();

        let notes = run_user(&c, "notes_all", &params(json!({}))).unwrap();
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0]["body"], "Later"); // newest first
        assert_eq!(notes[1]["book_id"], 45);
        assert_eq!(notes[1]["verse"], 28);
        assert_eq!(notes[1]["at"], 1_700_000_000_000_i64); // stored to the second

        run_user(&c, "note_remove", &params(json!({"id": id}))).unwrap();
        assert_eq!(run_user(&c, "notes_all", &params(json!({}))).unwrap().len(), 1);
    }

    #[test]
    fn a_verse_has_one_highlight_and_settings_overwrite() {
        let c = user_db();
        let verse = json!({"book": 19, "chapter": 23, "verse": 1});
        let with = |color: &str| {
            let mut p = params(verse.clone());
            p.insert("color".into(), json!(color));
            p
        };
        run_user(&c, "highlight_set", &with("yellow")).unwrap();
        run_user(&c, "highlight_set", &with("blue")).unwrap();
        let all = run_user(&c, "highlights_all", &params(json!({}))).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0]["color"], "blue");
        run_user(&c, "highlight_remove", &params(verse)).unwrap();
        assert!(run_user(&c, "highlights_all", &params(json!({}))).unwrap().is_empty());

        run_user(&c, "setting_set", &params(json!({"key": "prefs.fontSize", "value": "20"}))).unwrap();
        run_user(&c, "setting_set", &params(json!({"key": "prefs.fontSize", "value": "24"}))).unwrap();
        let settings = run_user(&c, "settings_all", &params(json!({}))).unwrap();
        let font: Vec<_> = settings.iter().filter(|r| r["key"] == "prefs.fontSize").collect();
        assert_eq!(font.len(), 1);
        assert_eq!(font[0]["value"], "24");
    }

    /// The schema as it was before the library tables changed shape: schema 1, with the old documents and doc_refs.
    const SCHEMA_1_LIBRARY: &str = "
        DROP TABLE doc_refs; DROP TABLE doc_chunks_fts; DROP TABLE doc_chunks; DROP TABLE documents;
        CREATE TABLE documents (id INTEGER PRIMARY KEY, title TEXT NOT NULL, author TEXT, format TEXT NOT NULL,
          original_name TEXT NOT NULL, sha256 TEXT NOT NULL UNIQUE, stored_path TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
          error TEXT, extracted_chars INTEGER, imported_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE doc_chunks (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
          seq INTEGER NOT NULL, heading TEXT, loc TEXT, text TEXT NOT NULL, UNIQUE (document_id, seq));
        CREATE VIRTUAL TABLE doc_chunks_fts USING fts5 (text, heading, content = 'doc_chunks', content_rowid = 'id');
        CREATE TABLE doc_refs (chunk_id INTEGER NOT NULL REFERENCES doc_chunks (id) ON DELETE CASCADE, book_id INTEGER NOT NULL,
          chapter INTEGER NOT NULL, verse_start INTEGER NOT NULL, verse_end INTEGER NOT NULL,
          PRIMARY KEY (chunk_id, book_id, chapter, verse_start, verse_end)) WITHOUT ROWID;
        UPDATE schema_info SET value = '1' WHERE key = 'schema_version';";

    fn columns(c: &Connection, table: &str) -> Vec<String> {
        let mut stmt = c.prepare(&format!("SELECT name FROM pragma_table_info('{table}')")).unwrap();
        stmt.query_map([], |r| r.get::<_, String>(0)).unwrap().map(|r| r.unwrap()).collect()
    }
    fn version(c: &Connection) -> String {
        c.query_row("SELECT value FROM schema_info WHERE key = 'schema_version'", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn a_schema_1_file_is_brought_forward_and_keeps_notes_and_settings() {
        let c = user_db();
        run_user(&c, "note_add", &params(json!({"book": 45, "chapter": 8, "verse": 28, "body": "kept", "at": 0}))).unwrap();
        run_user(&c, "setting_set", &params(json!({"key": "prefs.fontSize", "value": "24"}))).unwrap();
        c.execute_batch(SCHEMA_1_LIBRARY).unwrap();
        assert_eq!(version(&c), "1");
        assert!(!columns(&c, "doc_refs").contains(&"confidence".to_string()));

        init_user(&c).unwrap();

        assert_eq!(version(&c), "2");
        assert!(columns(&c, "doc_refs").contains(&"confidence".to_string()));
        assert_eq!(run_user(&c, "notes_all", &params(json!({}))).unwrap()[0]["body"], "kept");
        assert_eq!(run_user(&c, "settings_all", &params(json!({}))).unwrap().iter().filter(|r| r["key"] == "prefs.fontSize").count(), 1);
        // The new shape works: a document without a stored file, and FTS still follows the chunks.
        let doc = run_user(&c, "document_add", &params(json!({"title": "T", "author": null, "format": "txt", "original_name": "t.txt", "sha256": "a"}))).unwrap();
        assert!(doc[0]["id"].as_i64().is_some());
        init_user(&c).unwrap(); // and a file already at schema 2 is left alone
        assert_eq!(run_user(&c, "documents_all", &params(json!({}))).unwrap().len(), 1);
    }

    #[test]
    fn a_schema_1_file_with_documents_is_not_touched() {
        let c = user_db();
        c.execute_batch(SCHEMA_1_LIBRARY).unwrap();
        c.execute("INSERT INTO documents (title, format, original_name, sha256, stored_path) VALUES ('x', 'txt', 'x.txt', 'h', '/p')", []).unwrap();
        let err = init_user(&c).unwrap_err();
        assert!(err.contains("1 imported document"), "{err}");
        assert_eq!(version(&c), "1");
        assert_eq!(c.query_row("SELECT count(*) FROM documents", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    }

    /// One book, imported the way the UI does: document, chunks, references, finish. Then removed.
    #[test]
    fn a_document_is_imported_searched_listed_and_removed() {
        let mut c = user_db();
        let doc = run_user(&c, "document_add", &params(json!({"title": "Notes on Romans", "author": "A. Writer", "format": "md", "original_name": "romans.md", "sha256": "abc"}))).unwrap();
        let id = doc[0]["id"].as_i64().unwrap();
        let chunks = json!([
            {"seq": 0, "heading": "Romans 8", "loc": null, "text": "All things work together for good.", "refs": [
                {"book": 45, "chapter": 8, "from": 28, "to": 28, "confidence": "high"},
                {"book": 45, "chapter": 8, "from": 28, "to": 28, "confidence": "medium"},
                {"book": 45, "chapter": 8, "from": 1, "to": 39, "confidence": "medium"}]},
            {"seq": 1, "heading": null, "loc": "p. 2", "text": "No refs here.", "refs": []},
        ]);
        let ops = |name: &str| Op { name: name.into(), params: params(json!({"document": id, "chunks": chunks.to_string()})) };
        run_user_batch(&mut c, &[ops("doc_chunks_add"), ops("doc_refs_add")]).unwrap();
        run_user(&c, "document_finish", &params(json!({"id": id, "chars": 47}))).unwrap();

        let all = run_user(&c, "documents_all", &params(json!({}))).unwrap();
        assert_eq!((all[0]["status"].as_str(), all[0]["chunks"].as_i64(), all[0]["refs"].as_i64()), (Some("ready"), Some(2), Some(2))); // the repeated range is stored once
        assert_eq!(c.query_row("SELECT count(*) FROM doc_chunks_fts WHERE doc_chunks_fts MATCH 'together'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        let hit: String = c.query_row("SELECT confidence FROM doc_refs WHERE verse_start = 28", [], |r| r.get(0)).unwrap();
        assert_eq!(hit, "high"); // the first one in wins; the app sends the strongest first

        // Only a repeated reference is skipped. A value that breaks a constraint is an error, not a silent gap.
        let bad = json!([{"seq": 0, "heading": null, "loc": null, "text": "x", "refs": [{"book": 45, "chapter": 8, "from": 2, "to": 2, "confidence": "certain"}]}]);
        let bad_op = Op { name: "doc_refs_add".into(), params: params(json!({"document": id, "chunks": bad.to_string()})) };
        assert!(run_user_batch(&mut c, &[bad_op]).unwrap_err().contains("CHECK constraint failed"));
        let missing = json!([{"seq": 0, "heading": null, "loc": null, "text": "x", "refs": [{"book": 45, "chapter": 8, "from": 2, "to": 2}]}]);
        let missing_op = Op { name: "doc_refs_add".into(), params: params(json!({"document": id, "chunks": missing.to_string()})) };
        assert!(run_user_batch(&mut c, &[missing_op]).unwrap_err().contains("NOT NULL constraint failed"));
        assert_eq!(c.query_row("SELECT count(*) FROM doc_refs", [], |r| r.get::<_, i64>(0)).unwrap(), 2);

        // The same file again is found by its hash.
        let dup = run_user(&c, "document_by_hash", &params(json!({"sha256": "abc"}))).unwrap();
        assert_eq!(dup[0]["id"].as_i64(), Some(id));

        run_user(&c, "document_remove", &params(json!({"id": id}))).unwrap();
        for table in ["documents", "doc_chunks", "doc_refs"] {
            assert_eq!(c.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get::<_, i64>(0)).unwrap(), 0, "{table}");
        }
        assert_eq!(c.query_row("SELECT count(*) FROM doc_chunks_fts WHERE doc_chunks_fts MATCH 'together'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }

    #[test]
    fn an_interrupted_import_is_marked_failed_and_a_finished_one_is_not() {
        let c = user_db();
        let add = |hash: &str| run_user(&c, "document_add", &params(json!({"title": hash, "author": null, "format": "txt", "original_name": "a.txt", "sha256": hash}))).unwrap()[0]["id"].as_i64().unwrap();
        let (stuck, done) = (add("a"), add("b"));
        run_user(&c, "document_finish", &params(json!({"id": done, "chars": 1}))).unwrap();
        run_user(&c, "documents_fail_stale", &params(json!({}))).unwrap();
        let status = |id: i64| c.query_row("SELECT status FROM documents WHERE id = ?1", [id], |r| r.get::<_, String>(0)).unwrap();
        assert_eq!((status(stuck), status(done)), ("failed".to_string(), "ready".to_string()));
    }

    #[test]
    fn a_failed_batch_changes_nothing() {
        let mut c = user_db();
        let op = |name: &str, p: Value| Op { name: name.into(), params: params(p) };
        let good = op("note_add", json!({"book": 1, "chapter": 1, "verse": 1, "body": "In the beginning", "at": 0}));
        let err = run_user_batch(&mut c, &[good, op("note_add", json!({"book": 1}))]).unwrap_err();
        assert!(err.contains("Missing parameter"));
        assert!(run_user(&c, "notes_all", &params(json!({}))).unwrap().is_empty());

        let ok = [
            op("note_add", json!({"book": 1, "chapter": 1, "verse": 1, "body": "In the beginning", "at": 0})),
            op("setting_set", json!({"key": "migrated.localStorage", "value": "1"})),
        ];
        run_user_batch(&mut c, &ok).unwrap();
        assert_eq!(run_user(&c, "notes_all", &params(json!({}))).unwrap().len(), 1);
    }

    #[test]
    fn rejects_unknown_query_and_missing_params() {
        let c = Connection::open_in_memory().unwrap();
        assert!(run_named(&c, "drop_everything", &params(json!({}))).unwrap_err().contains("Unknown query"));
        // Fails on the missing parameter before touching any table.
        let mem = Connection::open_in_memory().unwrap();
        mem.execute_batch("CREATE TABLE lemmas (lemma_key, lang, lemma, strongs, occurrences);").unwrap();
        assert!(run_named(&mem, "lemma_info", &params(json!({}))).unwrap_err().contains("Missing parameter \"key\""));
        assert!(run_named(&mem, "lemma_info", &params(json!({"key": [1]}))).unwrap_err().contains("must be a string"));
    }

    #[test]
    fn every_query_prepares_against_the_real_schema() {
        let Some(c) = real_db() else { return };
        for (name, sql) in QUERIES {
            c.prepare(sql).unwrap_or_else(|e| panic!("{name}: {e}"));
        }
    }

    #[test]
    fn reads_a_chapter_and_its_greek() {
        let Some(c) = real_db() else { return };
        let verses = run_named(&c, "chapter_verses", &params(json!({"translation": "WEB", "book": 43, "chapter": 3}))).unwrap();
        assert_eq!(verses.len(), 36);
        assert!(verses[15]["text"].as_str().unwrap().starts_with("For God so loved the world"));
        let words = run_named(&c, "chapter_words", &params(json!({"book": 43, "chapter": 3}))).unwrap();
        assert!(words.len() > 400);
        assert_eq!(words[0]["lang"], "grc");
    }

    #[test]
    fn hebrew_versification_resolves_to_english_numbers() {
        let Some(c) = real_db() else { return };
        let words = run_named(&c, "chapter_words", &params(json!({"book": 19, "chapter": 3}))).unwrap();
        // eng_verse 0 is the psalm title, and Psalm 3's title is six words.
        assert_eq!(words.iter().filter(|w| w["verse"] == 0).count(), 6);
    }

    #[test]
    fn search_returns_snippets_with_marker_characters() {
        let Some(c) = real_db() else { return };
        let q = "\"loved\" \"world\"";
        let total = run_named(&c, "search_verses_count", &params(json!({"q": q, "translation": "WEB"}))).unwrap();
        assert!(total[0]["total"].as_i64().unwrap() > 5);
        let hits = run_named(&c, "search_verses", &params(json!({"q": q, "translation": "WEB", "limit": 5, "offset": 0}))).unwrap();
        assert_eq!(hits.len(), 5);
        assert!(hits[0]["snippet"].as_str().unwrap().contains('\u{2}'));
    }

    #[test]
    fn sql_injection_through_parameters_is_just_text() {
        let Some(c) = real_db() else { return };
        let rows = run_named(&c, "lemma_info", &params(json!({"key": "x' OR '1'='1"}))).unwrap();
        assert!(rows.is_empty());
    }
}
