//! 화면 읽기 (PC): 앞에 떠 있는 게임 창을 찍어 윈도우 내장 글자 인식(한국어)으로 읽고,
//! 읽은 글자와 위치(창 대비 비율)만 화면(웹)으로 보낸다. 휴대폰판(ScreenReadService.kt)과 같은 형식이라
//! 판단 규칙(src/lib/recognize.ts 등)을 그대로 쓴다. 그림은 저장하지도, 밖으로 보내지도 않는다.
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[derive(Default, Clone)]
pub struct ScreenRead(pub Arc<AtomicBool>);

#[derive(Serialize, Clone)]
pub struct Line {
    t: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Serialize, Clone)]
pub struct Frame {
    time: u64,
    landscape: bool,
    lines: Vec<Line>,
}

/// 가챠 화면이 보이면 그 뒤 20초 동안 1초마다, 아니면 2.5초마다 읽는다 (휴대폰판과 같음).
const SLOW: Duration = Duration::from_millis(2500);
const FAST: Duration = Duration::from_millis(1000);
const FAST_WINDOW: Duration = Duration::from_secs(20);
const GACHA_WORDS: [&str; 7] = ["헤드헌팅", "기원", "추출", "진행", "LUNACY", "UID", "획득 결과"];

#[tauri::command]
pub fn screen_read(app: AppHandle, state: State<'_, ScreenRead>, start: bool) -> Result<(), String> {
    if !start {
        state.0.store(false, Ordering::SeqCst);
        let _ = app.emit("screen-state", serde_json::json!({ "state": "stopped", "message": "" }));
        return Ok(());
    }
    if state.0.swap(true, Ordering::SeqCst) {
        return Ok(()); // 이미 켜져 있음
    }
    let flag = state.0.clone();
    std::thread::spawn(move || {
        if let Err(e) = imp::prepare(&app) {
            flag.store(false, Ordering::SeqCst);
            let _ = app.emit("screen-state", serde_json::json!({ "state": "error", "message": e }));
            return;
        }
        let _ = app.emit("screen-state", serde_json::json!({ "state": "started", "message": "" }));
        let mut last_gacha = std::time::Instant::now() - FAST_WINDOW;
        while flag.load(Ordering::SeqCst) {
            match imp::read_once() {
                Ok(Some(frame)) => {
                    if frame.lines.iter().any(|l| GACHA_WORDS.iter().any(|w| l.t.contains(w))) {
                        last_gacha = std::time::Instant::now();
                    }
                    let _ = app.emit("screen-text", frame);
                }
                Ok(None) => {} // 우리 창이 앞에 있거나 창이 없음
                Err(e) => {
                    flag.store(false, Ordering::SeqCst);
                    let _ = app.emit("screen-state", serde_json::json!({ "state": "error", "message": e }));
                    return;
                }
            }
            std::thread::sleep(if last_gacha.elapsed() < FAST_WINDOW { FAST } else { SLOW });
        }
    });
    Ok(())
}

#[tauri::command]
pub fn screen_reading(state: State<'_, ScreenRead>) -> bool {
    state.0.load(Ordering::SeqCst)
}

#[cfg(not(windows))]
mod imp {
    use super::Frame;
    use tauri::AppHandle;
    pub fn prepare(_app: &AppHandle) -> Result<(), String> {
        Err("화면 읽기는 윈도우에서만 됩니다".into())
    }
    pub fn read_once() -> Result<Option<Frame>, String> {
        Ok(None)
    }
}

#[cfg(windows)]
mod imp {
    use super::{Frame, Line};
    use tauri::{AppHandle, Manager};
    use windows::core::HSTRING;
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        BitBlt, ClientToScreen, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
        ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
    };
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetForegroundWindow, GetWindowThreadProcessId, SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
    };

    fn err<E: std::fmt::Display>(what: &str) -> impl Fn(E) -> String + '_ {
        move |e| format!("{what}: {e}")
    }

    /// 우리 창은 화면 캡처에 안 찍히게 한다(창 글자를 게임 글자로 읽지 않게). 한국어 인식이 되는지도 확인한다.
    pub fn prepare(app: &AppHandle) -> Result<(), String> {
        if let Some(win) = app.get_webview_window("main") {
            if let Ok(hwnd) = win.hwnd() {
                // SAFETY: 우리 창의 유효한 핸들. 실패해도(구형 윈도우) 계속한다.
                unsafe {
                    let _ = SetWindowDisplayAffinity(HWND(hwnd.0 as _), WDA_EXCLUDEFROMCAPTURE);
                }
            }
        }
        engine().map(|_| ())
    }

    fn engine() -> Result<OcrEngine, String> {
        let lang = Language::CreateLanguage(&HSTRING::from("ko")).map_err(err("언어 설정"))?;
        if !OcrEngine::IsLanguageSupported(&lang).unwrap_or(false) {
            return Err("윈도우에 한국어 글자 인식이 설치돼 있지 않습니다 (설정 → 시간 및 언어 → 언어 → 한국어 → 언어 옵션에서 '광학 문자 인식' 추가)".into());
        }
        OcrEngine::TryCreateFromLanguage(&lang).map_err(err("글자 인식 준비"))
    }

    /// 앞에 떠 있는 창의 안쪽 영역을 찍어 BGRA 바이트로 돌려준다. 우리 창이 앞이면 None.
    fn capture() -> Result<Option<(Vec<u8>, i32, i32)>, String> {
        // SAFETY: 표준 GDI 호출. 만든 DC·비트맵은 이 함수 안에서 모두 해제한다.
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return Ok(None);
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == GetCurrentProcessId() {
                return Ok(None);
            }
            let mut rc = RECT::default();
            GetClientRect(hwnd, &mut rc).map_err(err("창 크기"))?;
            let (w, h) = (rc.right - rc.left, rc.bottom - rc.top);
            if w < 400 || h < 300 {
                return Ok(None);
            }
            let mut origin = POINT { x: 0, y: 0 };
            let _ = ClientToScreen(hwnd, &mut origin);

            let screen = GetDC(None);
            let mem = CreateCompatibleDC(Some(screen));
            let bmp = CreateCompatibleBitmap(screen, w, h);
            let old = SelectObject(mem, bmp.into());
            let blt = BitBlt(mem, 0, 0, w, h, Some(screen), origin.x, origin.y, SRCCOPY);
            let mut info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h, // 위에서 아래로
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut buf = vec![0u8; (w as usize) * (h as usize) * 4];
            let got = GetDIBits(mem, bmp, 0, h as u32, Some(buf.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
            SelectObject(mem, old);
            let _ = DeleteObject(bmp.into());
            let _ = DeleteDC(mem);
            ReleaseDC(None, screen);
            blt.map_err(err("화면 찍기"))?;
            if got == 0 {
                return Err("화면을 읽지 못했습니다".into());
            }
            Ok(Some((buf, w, h)))
        }
    }

    pub fn read_once() -> Result<Option<Frame>, String> {
        let Some((bytes, w, h)) = capture()? else { return Ok(None) };
        let writer = DataWriter::new().map_err(err("버퍼"))?;
        writer.WriteBytes(&bytes).map_err(err("버퍼"))?;
        let buffer = writer.DetachBuffer().map_err(err("버퍼"))?;
        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w, h).map_err(err("그림 변환"))?;
        let result = engine()?
            .RecognizeAsync(&bitmap)
            .map_err(err("글자 인식"))?
            .get()
            .map_err(err("글자 인식"))?;
        let mut lines = Vec::new();
        for line in result.Lines().map_err(err("결과"))? {
            let (mut l, mut t, mut r, mut b) = (f64::MAX, f64::MAX, 0f64, 0f64);
            for word in line.Words().map_err(err("결과"))? {
                let rect = word.BoundingRect().map_err(err("결과"))?;
                l = l.min(rect.X as f64);
                t = t.min(rect.Y as f64);
                r = r.max((rect.X + rect.Width) as f64);
                b = b.max((rect.Y + rect.Height) as f64);
            }
            if r <= l {
                continue;
            }
            lines.push(Line {
                t: line.Text().map_err(err("결과"))?.to_string(),
                x: l / w as f64,
                y: t / h as f64,
                w: (r - l) / w as f64,
                h: (b - t) / h as f64,
            });
        }
        let time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Ok(Some(Frame { time, landscape: w > h, lines }))
    }
}
