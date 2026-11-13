mod db;
mod packs;

use rusqlite::{Connection, OpenFlags};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

use packs::ManifestEntry;

/// SQLite connections are not `Sync`, so each lives behind a Mutex. Queries are short; contention is not a concern.
struct AppState {
    bible: Mutex<Connection>,
    /// The user's own data (notes, highlights, settings; imported books later). The only database the app writes to.
    user: Mutex<Connection>,
    /// Downloaded translations, one read-only connection per pack. See packs.rs.
    packs: Mutex<HashMap<String, Connection>>,
    packs_dir: PathBuf,
}

#[tauri::command]
fn query(state: State<'_, AppState>, name: String, params: Option<Map<String, Value>>) -> Result<Vec<Value>, String> {
    let params = params.unwrap_or_default();
    // Reader and search queries for a downloaded translation run on that translation's own database.
    if packs::PACK_QUERIES.contains(&name.as_str()) {
        if let Some(Value::String(t)) = params.get("translation") {
            let packs = state.packs.lock().map_err(|_| "database lock poisoned".to_string())?;
            if let Some(conn) = packs.get(t) {
                return db::run_named(conn, &name, &params);
            }
        }
    }
    let conn = state.bible.lock().map_err(|_| "database lock poisoned".to_string())?;
    db::run_named(&conn, &name, &params)
}

/// One named statement from data/queries/user/ against user.db. This is the only way the UI writes anything.
#[tauri::command]
fn user_query(state: State<'_, AppState>, name: String, params: Option<Map<String, Value>>) -> Result<Vec<Value>, String> {
    let conn = state.user.lock().map_err(|_| "database lock poisoned".to_string())?;
    db::run_user(&conn, &name, &params.unwrap_or_default())
}

/// Several named statements against user.db in one transaction, so a multi-row change cannot half apply.
#[tauri::command]
fn user_batch(state: State<'_, AppState>, ops: Vec<db::Op>) -> Result<(), String> {
    let mut conn = state.user.lock().map_err(|_| "database lock poisoned".to_string())?;
    db::run_user_batch(&mut conn, &ops)
}

/// The translations on offer: the catalog from the manifest, whether or not each is installed.
#[tauri::command]
async fn translation_catalog() -> Result<Vec<ManifestEntry>, String> {
    tauri::async_runtime::spawn_blocking(|| packs::fetch_manifest(&packs::manifest_url())).await.map_err(|e| e.to_string())?
}

/// Downloaded translations, as `sources` rows. Reads each pack's own `sources` table.
#[tauri::command]
fn installed_translations(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let packs = state.packs.lock().map_err(|_| "database lock poisoned".to_string())?;
    let mut out = Vec::new();
    for conn in packs.values() {
        for row in db::run_named(conn, "sources", &Map::new())? {
            if row.get("kind").and_then(Value::as_str) == Some("translation") {
                out.push(row);
            }
        }
    }
    out.sort_by_key(|r| r.get("id").and_then(Value::as_str).unwrap_or_default().to_string());
    Ok(out)
}

#[tauri::command]
async fn install_translation(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let dir = state.packs_dir.clone();
    let wanted = id.clone();
    let path = tauri::async_runtime::spawn_blocking(move || packs::download_and_install(&dir, &packs::manifest_url(), &wanted)).await.map_err(|e| e.to_string())??;
    let conn = packs::open_pack(&path)?;
    state.packs.lock().map_err(|_| "database lock poisoned".to_string())?.insert(id, conn);
    Ok(())
}

#[tauri::command]
fn remove_translation(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if !packs::valid_id(&id) {
        return Err(format!("\"{id}\" is not a valid translation id"));
    }
    let mut packs = state.packs.lock().map_err(|_| "database lock poisoned".to_string())?;
    packs.remove(&id); // close the connection before deleting the file
    match std::fs::remove_file(state.packs_dir.join(format!("{id}.db"))) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("cannot remove {id}: {e}")),
    }
}

/// Finds the reference database: an explicit override, then the app bundle, then the dev build output.
fn find_bible_db(app: &tauri::App) -> Result<PathBuf, String> {
    let mut tried = Vec::new();
    if let Ok(p) = std::env::var("PELLIKAN_DB") {
        tried.push(PathBuf::from(p));
    }
    if let Ok(p) = app.path().resolve("bible.db", tauri::path::BaseDirectory::Resource) {
        tried.push(p);
    }
    tried.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../data/build/bible.db"));
    tried
        .iter()
        .find(|p| p.is_file())
        .cloned()
        .ok_or_else(|| format!("bible.db not found. Run `npm run data` first. Looked in: {tried:?}"))
}

fn open_user_db(app: &tauri::App) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {dir:?}: {e}"))?;
    let conn = Connection::open(dir.join("user.db")).map_err(|e| e.to_string())?;
    db::init_user(&conn)?;
    Ok(conn)
}

/// Every command the web view can call. One list, used by `run()` and by the IPC tests below, so a command that is
/// tested is a command that ships.
fn handlers<R: tauri::Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![query, user_query, user_batch, translation_catalog, installed_translations, install_translation, remove_translation]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let bible_path = find_bible_db(app)?;
            let bible = Connection::open_with_flags(&bible_path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
                .map_err(|e| format!("cannot open {bible_path:?}: {e}"))?;
            let user = open_user_db(app)?;
            let packs_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("translations");
            let installed: HashMap<String, Connection> = packs::scan(&packs_dir).into_iter().collect();
            app.manage(AppState { bible: Mutex::new(bible), user: Mutex::new(user), packs: Mutex::new(installed), packs_dir });
            Ok(())
        })
        .invoke_handler(handlers())
        .run(tauri::generate_context!())
        .expect("error while running Pellikan");
}

/// The web view to Rust boundary, through Tauri's mock runtime: command registration, argument names and shapes as
/// `app/composables/useBible.ts` sends them, and results as it reads them. This does not open a window or load the real
/// capability files; those are covered only by running the app.
#[cfg(test)]
mod ipc_tests {
    use super::*;
    use serde_json::json;
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
    use tauri::webview::{InvokeRequest, WebviewWindowBuilder};

    fn webview() -> (tauri::App<MockRuntime>, tauri::WebviewWindow<MockRuntime>) {
        let user = Connection::open_in_memory().unwrap();
        db::init_user(&user).unwrap();
        let state = AppState {
            bible: Mutex::new(Connection::open_in_memory().unwrap()),
            user: Mutex::new(user),
            packs: Mutex::new(HashMap::new()),
            packs_dir: std::env::temp_dir().join("pellikan-ipc-test-packs"),
        };
        let app = mock_builder().invoke_handler(handlers()).manage(state).build(mock_context(noop_assets())).unwrap();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
        (app, webview)
    }

    /// The app's own origin. Tauri only lets local content call app commands; `http://tauri.localhost` is the
    /// Windows form and is not local here.
    const APP_ORIGIN: &str = "tauri://localhost";

    /// Calls a command the way `invoke(cmd, args)` does, returning its JSON result or its error.
    fn invoke(webview: &tauri::WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Result<Value, Value> {
        invoke_from(webview, APP_ORIGIN, cmd, args)
    }

    fn invoke_from(webview: &tauri::WebviewWindow<MockRuntime>, origin: &str, cmd: &str, args: Value) -> Result<Value, Value> {
        let request = InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: origin.parse().unwrap(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        };
        get_ipc_response(webview, request).map(|body| body.deserialize::<Value>().unwrap())
    }

    #[test]
    fn user_query_and_user_batch_round_trip_through_ipc() {
        let (_app, w) = webview();
        // Same argument shape as userQuery() in useBible.ts: { name, params }.
        let added = invoke(&w, "user_query", json!({"name": "note_add", "params": {"book": 45, "chapter": 8, "verse": 28, "body": "via IPC", "at": 1_700_000_000_000_i64}})).unwrap();
        assert!(added[0]["id"].as_i64().is_some());

        // Same shape as userBatch(): { ops: [{ name, params }] }.
        invoke(&w, "user_batch", json!({"ops": [
            {"name": "highlight_set", "params": {"book": 45, "chapter": 8, "verse": 28, "color": "green"}},
            {"name": "setting_set", "params": {"key": "prefs.translation", "value": "\"KJV\""}}
        ]}))
        .unwrap();

        let notes = invoke(&w, "user_query", json!({"name": "notes_all", "params": {}})).unwrap();
        assert_eq!(notes[0]["body"], "via IPC");
        assert_eq!(notes[0]["book_id"], 45);
        let highlights = invoke(&w, "user_query", json!({"name": "highlights_all", "params": {}})).unwrap();
        assert_eq!(highlights[0]["color"], "green");
        let settings = invoke(&w, "user_query", json!({"name": "settings_all", "params": {}})).unwrap();
        assert!(settings.as_array().unwrap().iter().any(|r| r["key"] == "prefs.translation" && r["value"] == "\"KJV\""));
    }

    #[test]
    fn ipc_errors_come_back_as_plain_strings_and_a_failed_batch_applies_nothing() {
        let (_app, w) = webview();
        // errorMessage() in useBible.ts expects a Tauri command error to be a string.
        assert_eq!(invoke(&w, "user_query", json!({"name": "chapter_verses", "params": {}})).unwrap_err(), json!("Unknown query \"chapter_verses\""));
        let err = invoke(&w, "user_batch", json!({"ops": [
            {"name": "setting_set", "params": {"key": "a", "value": "1"}},
            {"name": "note_add", "params": {"book": 1}}
        ]}))
        .unwrap_err();
        assert!(err.as_str().unwrap().contains("Missing parameter"));
        assert_eq!(invoke(&w, "user_query", json!({"name": "settings_all", "params": {}})).unwrap(), json!([]));
        // useBible.ts always sends params, but the command accepts a missing one too.
        assert_eq!(invoke(&w, "user_query", json!({"name": "settings_all"})).unwrap(), json!([]));
    }

    #[test]
    fn remote_content_cannot_write_user_data() {
        let (_app, w) = webview();
        let args = json!({"name": "setting_set", "params": {"key": "x", "value": "y"}});
        assert!(invoke_from(&w, "https://example.com", "user_query", args).unwrap_err().as_str().unwrap().contains("not allowed"));
        assert!(invoke_from(&w, "https://example.com", "user_batch", json!({"ops": []})).is_err());
        assert_eq!(invoke(&w, "user_query", json!({"name": "settings_all", "params": {}})).unwrap(), json!([]));
    }
}
