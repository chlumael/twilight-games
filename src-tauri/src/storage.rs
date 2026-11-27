//! Local JSON storage: atomic writes, daily backups, export/import via file dialogs.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const ALLOWED: &[&str] = &["records", "settings", "banners", "images"];
const BACKUPS_KEPT: usize = 7;

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn file_for(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if !ALLOWED.contains(&name) {
        return Err(format!("unknown store: {name}"));
    }
    Ok(data_dir(app)?.join(format!("{name}.json")))
}

/// Write to a temp file and rename over the target so a crash never leaves a half-written file.
fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Keep one copy of the records per day, newest `BACKUPS_KEPT` days.
fn daily_backup(app: &AppHandle, current: &Path) -> Result<(), String> {
    if !current.exists() {
        return Ok(());
    }
    let dir = data_dir(app)?.join("backups");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let target = dir.join(format!("records-{today}.json"));
    if !target.exists() {
        fs::copy(current, &target).map_err(|e| e.to_string())?;
    }
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    while files.len() > BACKUPS_KEPT {
        let old = files.remove(0);
        let _ = fs::remove_file(old);
    }
    Ok(())
}

#[tauri::command]
pub fn read_store(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let path = file_for(&app, &name)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_store(app: AppHandle, name: String, content: String) -> Result<(), String> {
    let path = file_for(&app, &name)?;
    if name == "records" {
        daily_backup(&app, &path)?;
    }
    write_atomic(&path, &content)
}

/// Ask where to save, then write the given JSON. Returns the chosen path, or None if cancelled.
#[tauri::command]
pub async fn export_backup(app: AppHandle, content: String) -> Result<Option<String>, String> {
    let name = format!("황혼게임즈-백업-{}.json", chrono::Local::now().format("%Y%m%d-%H%M%S"));
    let picked = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .set_file_name(name)
        .blocking_save_file();
    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

/// Ask for a backup file and return its contents. The frontend validates before saving.
#[tauri::command]
pub async fn import_backup(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app.dialog().file().add_filter("JSON", &["json"]).blocking_pick_file();
    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}
