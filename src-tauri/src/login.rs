//! PC판 구글 로그인: 프로그램 안의 웹 화면에서는 구글 로그인이 막히므로, 기본 브라우저로 우리 웹앱의
//! 로그인 도우미 화면을 열고, 로그인 결과(구글 ID 토큰)를 이 컴퓨터 안의 임시 주소(127.0.0.1)로 돌려받는다.
//! 토큰은 저장하지 않고 화면(웹)으로 넘겨 Firebase 로그인에만 쓴다. 휴대폰 앱의 로그인과 같은 구조다.
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const HELPER: &str = "https://chlumael.github.io/twilight-games/";
const WAIT: Duration = Duration::from_secs(300);

fn random_hex() -> String {
    // 표준 라이브러리의 해시 시드는 운영체제 난수로 정해진다.
    let a = RandomState::new().build_hasher().finish();
    let b = RandomState::new().build_hasher().finish();
    format!("{a:016x}{b:016x}")
}

fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    let r = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn();
    #[cfg(not(windows))]
    let r = std::process::Command::new("xdg-open").arg(url).spawn();
    r.map(|_| ()).map_err(|e| format!("브라우저를 열지 못했습니다: {e}"))
}

fn query_value<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query.split('&').find_map(|kv| kv.strip_prefix(key).and_then(|v| v.strip_prefix('=')))
}

fn respond(stream: &mut std::net::TcpStream, ok: bool) {
    let body = if ok {
        "<!doctype html><meta charset=utf-8><title>황혼 게임즈</title><body style='font-family:sans-serif;padding:40px'><h2>로그인이 끝났습니다</h2><p>이 창을 닫고 황혼 게임즈로 돌아가세요.</p>"
    } else {
        "<!doctype html><meta charset=utf-8><title>황혼 게임즈</title><body style='font-family:sans-serif;padding:40px'><h2>로그인 정보를 받지 못했습니다</h2><p>황혼 게임즈에서 다시 시도해 주세요.</p>"
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        if ok { "200 OK" } else { "400 Bad Request" },
        body.len(),
        body
    );
}

/// 브라우저를 열고 결과를 기다린다. 결과는 "google-token" 이벤트({ token } 또는 { error })로 보낸다.
#[tauri::command]
pub fn google_login(app: AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("로그인 준비 실패: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let state = random_hex();
    open_browser(&format!("{HELPER}?pclogin={port}&state={state}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        let started = Instant::now();
        while started.elapsed() < WAIT {
            let Ok((mut stream, _)) = listener.accept() else {
                std::thread::sleep(Duration::from_millis(150));
                continue;
            };
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
            let mut buf = vec![0u8; 16 * 1024];
            let n = stream.read(&mut buf).unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]);
            let path = request.lines().next().and_then(|l| l.split(' ').nth(1)).unwrap_or("");
            let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");
            let token = query_value(query, "token").filter(|t| !t.is_empty());
            let good = query_value(query, "state") == Some(state.as_str());
            match (good, token) {
                (true, Some(t)) => {
                    respond(&mut stream, true);
                    let _ = app.emit("google-token", serde_json::json!({ "token": t }));
                    return;
                }
                _ => respond(&mut stream, false), // 다른 요청(파비콘 등)은 무시하고 계속 기다린다
            }
        }
        let _ = app.emit("google-token", serde_json::json!({ "error": "로그인 시간이 지났습니다. 다시 시도해 주세요." }));
    });
    Ok(())
}

const DOWNLOAD: &str = "https://github.com/chlumael/twilight-games/releases/latest/download/twilight-games-pc-setup.exe";

/// 새 버전 설치 파일을 기본 브라우저로 내려받게 한다 (주소는 고정).
#[tauri::command]
pub fn open_download() -> Result<(), String> {
    open_browser(DOWNLOAD)
}

/// 버튼 하나로 업데이트: 설치 파일을 임시 폴더에 받아 실행하고 프로그램을 끝낸다.
/// 주소는 우리 저장소의 최신 릴리스로 고정이고(https), 윈도우에 들어 있는 curl로 받는다.
/// 설치 프로그램은 진행 상황만 보여 주고(/P) 끝나면 프로그램을 다시 켠다(/R).
#[tauri::command(async)]
pub fn install_update(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let path = std::env::temp_dir().join("twilight-games-pc-setup.exe");
        let _ = std::fs::remove_file(&path);
        let status = std::process::Command::new("curl.exe")
            .args(["-L", "--fail", "--silent", "--max-time", "300", "-o"])
            .arg(&path)
            .arg(DOWNLOAD)
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| format!("내려받기를 시작하지 못했습니다: {e}"))?;
        if !status.success() {
            return Err("설치 파일을 받지 못했습니다. 인터넷 연결을 확인해 주세요.".into());
        }
        // 받은 것이 실행 파일인지 확인한다 (크기와 머리 글자 "MZ")
        let mut head = [0u8; 2];
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let read = std::fs::File::open(&path).and_then(|mut f| f.read_exact(&mut head));
        if read.is_err() || &head != b"MZ" || size < 1_000_000 {
            let _ = std::fs::remove_file(&path);
            return Err("받은 설치 파일이 올바르지 않습니다. 다시 시도해 주세요.".into());
        }
        std::process::Command::new(&path)
            .args(["/P", "/R"])
            .spawn()
            .map_err(|e| format!("설치 프로그램을 실행하지 못했습니다: {e}"))?;
        app.exit(0);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("윈도우에서만 쓸 수 있습니다".into())
    }
}
