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
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub running: Vec<String>,
    pub foreground: Option<String>,
    /// 맨 앞 창의 실행 파일 이름과 창 이름 (우리 창이 앞이면 그 전에 보던 창).
    /// 설정에 보여 줘서 게임이 안 잡힐 때 실제 이름을 알 수 있게 하고, 창 이름으로도 게임을 알아본다(사용자 PC 실기 2026-11-27: 명일방주가 안 잡힘)
    pub foreground_exe: Option<String>,
    pub foreground_title: Option<String>,
}

/// 맨 앞 창의 (프로세스 번호, 창 이름)
#[cfg(windows)]
fn foreground_window() -> Option<(u32, String)> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};
    // SAFETY: plain Win32 calls with valid out-pointers/buffers; a null HWND yields pid 0.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return None;
        }
        let mut buf = [0u16; 256];
        let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        Some((pid, title))
    }
}

#[cfg(not(windows))]
fn foreground_window() -> Option<(u32, String)> {
    None
}

fn detect(sys: &mut System, map: &BTreeMap<String, Vec<String>>) -> Detection {
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let win = foreground_window().filter(|(pid, _)| *pid != std::process::id());
    let fg = win.as_ref().map(|(pid, _)| *pid);
    let foreground_exe = fg.and_then(|pid| sys.process(sysinfo::Pid::from_u32(pid))).map(|p| p.name().to_string_lossy().to_string());
    let foreground_title = win.map(|(_, t)| t);
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
    Detection { running: running.into_iter().collect(), foreground, foreground_exe, foreground_title }
}

pub fn start(app: AppHandle, map: Arc<Mutex<BTreeMap<String, Vec<String>>>>) {
    thread::spawn(move || {
        let mut sys = System::new();
        let mut last: Option<Detection> = None;
        loop {
            let snapshot = map.lock().map(|m| m.clone()).unwrap_or_default();
            let mut d = detect(&mut sys, &snapshot);
            // 우리 창이 앞이면(설정을 보는 중) 그 전에 앞에 있던 창 이름을 그대로 둔다
            if d.foreground_exe.is_none() {
                if let Some(prev) = &last {
                    d.foreground_exe = prev.foreground_exe.clone();
                    d.foreground_title = prev.foreground_title.clone();
                }
            }
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
