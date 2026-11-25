mod detect;
mod login;
mod screen;
mod storage;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Default)]
struct ClickThrough(AtomicBool);

fn apply_click_through(app: &AppHandle, on: bool) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("main window missing")?;
    window.set_ignore_cursor_events(on).map_err(|e| e.to_string())?;
    app.state::<ClickThrough>().0.store(on, Ordering::SeqCst);
    app.emit("click-through", on).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_click_through(app: AppHandle, on: bool) -> Result<(), String> {
    apply_click_through(&app, on)
}

#[tauri::command]
fn get_click_through(state: State<'_, ClickThrough>) -> bool {
    state.0.load(Ordering::SeqCst)
}

/// Default hotkeys (DESIGN.md §8). Click-through is handled here because the
/// window cannot receive clicks while it is on; the rest are forwarded to the UI.
fn hotkeys() -> Vec<(Shortcut, &'static str)> {
    let m = Some(Modifiers::CONTROL | Modifiers::ALT);
    vec![
        (Shortcut::new(m, Code::KeyT), "toggle-click-through"),
        (Shortcut::new(m, Code::KeyH), "toggle-collapse"),
        (Shortcut::new(m, Code::KeyQ), "open-review"),
        (Shortcut::new(m, Code::KeyZ), "undo"),
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let process_map = detect::ProcessMap::default();
    let detect_map = process_map.0.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let Some((_, action)) = hotkeys().into_iter().find(|(s, _)| s == shortcut) else {
                        return;
                    };
                    if action == "toggle-click-through" {
                        let on = !app.state::<ClickThrough>().0.load(Ordering::SeqCst);
                        let _ = apply_click_through(app, on);
                    } else {
                        let _ = app.emit("hotkey", action);
                    }
                })
                .build(),
        )
        .manage(ClickThrough::default())
        .manage(process_map)
        .manage(screen::ScreenRead::default())
        .setup(move |app| {
            for (shortcut, action) in hotkeys() {
                // Another app may own the combination; keep running without it.
                if let Err(e) = app.global_shortcut().register(shortcut) {
                    eprintln!("hotkey {action} not registered: {e}");
                }
            }
            detect::start(app.handle().clone(), detect_map);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_click_through,
            get_click_through,
            storage::read_store,
            storage::write_store,
            storage::export_backup,
            storage::import_backup,
            detect::set_process_map,
            detect::list_processes,
            screen::screen_read,
            screen::screen_reading,
            login::google_login,
            login::open_download,
            login::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
