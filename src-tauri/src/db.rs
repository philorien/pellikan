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

/// Opens the pragmas user.db relies on and applies its schema. Idempotent: safe on every launch
/// (see data/schema/user.sql).
pub fn init_user(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;").map_err(|e| e.to_string())?;
    conn.execute_batch(include_str!("../../data/schema/user.sql")).map_err(|e| format!("user.db schema: {e}"))
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
