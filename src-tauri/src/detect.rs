//! Game detection: which configured game executables are running, and which one is in front.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, State};

const POLL: Duration = Duration::from_secs(2);

/// game id -> executable names (lower-cased for comparison).
#[derive(Default)]
pub struct ProcessMap(pub Arc<Mutex<BTreeMap<String, Vec<String>>>>);

#[derive(Clone, Serialize, PartialEq, Debug)]
pub struct Detection {
    pub running: Vec<String>,
    pub foreground: Option<String>,
}

#[cfg(windows)]
fn foreground_pid() -> Option<u32> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    // SAFETY: plain Win32 calls with a valid out-pointer; a null HWND yields pid 0.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        (pid != 0).then_some(pid)
    }
}

#[cfg(not(windows))]
fn foreground_pid() -> Option<u32> {
    None
}

fn detect(sys: &mut System, map: &BTreeMap<String, Vec<String>>) -> Detection {
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let fg = foreground_pid();
    let mut running = BTreeSet::new();
    let mut foreground = None;
    for (pid, proc_) in sys.processes() {
        let name = proc_.name().to_string_lossy().to_lowercase();
        for (game, names) in map {
            if names.iter().any(|n| *n == name) {
                running.insert(game.clone());
                if fg == Some(pid.as_u32()) {
                    foreground = Some(game.clone());
                }
            }
        }
    }
    Detection { running: running.into_iter().collect(), foreground }
}

pub fn start(app: AppHandle, map: Arc<Mutex<BTreeMap<String, Vec<String>>>>) {
    thread::spawn(move || {
        let mut sys = System::new();
        let mut last: Option<Detection> = None;
        loop {
            let snapshot = map.lock().map(|m| m.clone()).unwrap_or_default();
            let d = detect(&mut sys, &snapshot);
            if last.as_ref() != Some(&d) {
                let _ = app.emit("game-detected", &d);
                last = Some(d);
            }
            thread::sleep(POLL);
        }
    });
}

#[tauri::command]
pub fn set_process_map(state: State<'_, ProcessMap>, map: BTreeMap<String, Vec<String>>) -> Result<(), String> {
    let normalized = map
        .into_iter()
        .map(|(k, v)| (k, v.into_iter().map(|n| n.trim().to_lowercase()).filter(|n| !n.is_empty()).collect()))
        .collect();
    *state.0.lock().map_err(|e| e.to_string())? = normalized;
    Ok(())
}

/// Names of running executables, for picking a game's process in settings.
#[tauri::command]
pub fn list_processes() -> Vec<String> {
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let names: BTreeSet<String> =
        sys.processes().values().map(|p| p.name().to_string_lossy().to_string()).collect();
    names.into_iter().collect()
}
