//! 화면 읽기 (PC): 앞에 떠 있는 게임 창을 찍어 윈도우 내장 글자 인식(한국어)으로 읽고,
//! 읽은 글자와 위치(창 대비 비율)만 화면(웹)으로 보낸다. 휴대폰판(ScreenReadService.kt)과 같은 형식이라
//! 판단 규칙(src/lib/recognize.ts 등)을 그대로 쓴다. 그림은 저장하지도, 밖으로 보내지도 않는다.
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
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
    /** 진단용: 찍은 창의 크기와, 그림이 거의 한 가지 색인지(검게 찍힘) */
    width: i32,
    height: i32,
    blank: bool,
}

/// 잘라 읽기 결과 (src/lib/engine.ts의 RegionFrame과 같은 모양)
#[derive(Serialize, Clone)]
pub struct RegionFrame {
    time: u64,
    width: i32,
    height: i32,
    screen: Option<String>,
    fields: std::collections::BTreeMap<String, String>,
    tops: Vec<bool>,
    prints: Vec<String>,
}

/// 화면 틀 (data/screens/*.json). 화면(웹)이 시작할 때 넘겨준다.
#[derive(Default, Clone)]
pub struct ScreenProfiles(pub Arc<Mutex<Vec<crate::regions::Profile>>>);

#[tauri::command]
pub fn set_screen_profiles(state: State<'_, ScreenProfiles>, profiles: Vec<crate::regions::Profile>) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = profiles;
    Ok(())
}

/// 가챠 화면이 보이면 그 뒤 20초 동안 0.6초마다, 아니면 1.5초마다 읽는다.
/// (사용자 PC 실기 2026-11-27: 재화가 너무 늦게 바뀜 → 간격을 줄이고, 아래에서 글자 인식 자체도 빠르게 했다)
const SLOW: Duration = Duration::from_millis(1500);
const FAST: Duration = Duration::from_millis(600);
const FAST_WINDOW: Duration = Duration::from_secs(20);
/// 반복 간격. 새 방식의 화면 판단(작은 부분 모양 비교)은 이 간격마다 한다(글자 인식은 판단된 화면의 칸만).
const PROBE: Duration = Duration::from_millis(250);
// 윈도우 글자 인식은 "헤드헌팅"을 "해드현팅"처럼 읽기도 해서 조각 낱말도 넣는다.
const GACHA_WORDS: [&str; 10] = ["헤드헌팅", "헌팅", "현팅", "해드", "기원", "추출", "진행", "LUNACY", "UID", "획득결과"];

#[tauri::command]
pub fn screen_read(app: AppHandle, state: State<'_, ScreenRead>, profiles: State<'_, ScreenProfiles>, start: bool) -> Result<(), String> {
    if !start {
        state.0.store(false, Ordering::SeqCst);
        let _ = app.emit("screen-state", serde_json::json!({ "state": "stopped", "message": "" }));
        return Ok(());
    }
    if state.0.swap(true, Ordering::SeqCst) {
        return Ok(()); // 이미 켜져 있음
    }
    let flag = state.0.clone();
    let profiles = profiles.0.clone();
    std::thread::spawn(move || {
        if let Err(e) = imp::prepare(&app) {
            flag.store(false, Ordering::SeqCst);
            let _ = app.emit("screen-state", serde_json::json!({ "state": "error", "message": e }));
            return;
        }
        let _ = app.emit("screen-state", serde_json::json!({ "state": "started", "message": "" }));
        let mut last_gacha = std::time::Instant::now() - FAST_WINDOW;
        // 화면 전체 글자 읽기(예전 방식)를 마지막으로 한 때. 잘라 읽기(새 방식)는 0.25초마다 판단만 해서 결과 화면을 놓치지 않게 한다
        let mut last_full = std::time::Instant::now() - SLOW;
        while flag.load(Ordering::SeqCst) {
            // 새 방식(정해진 위치만 잘라 읽기): 판단 가능한 화면이 있을 때만
            let snapshot = profiles.lock().map(|p| p.clone()).unwrap_or_default();
            if crate::regions::any_ready(&snapshot) {
                match imp::read_regions(&snapshot) {
                    Ok(Some(frame)) => {
                        if frame.screen.is_some() {
                            last_gacha = std::time::Instant::now();
                        }
                        let _ = app.emit("screen-regions", frame);
                    }
                    Ok(None) => {}
                    Err(e) => {
                        let _ = app.emit("screen-state", serde_json::json!({ "state": "warn", "message": e }));
                    }
                }
            }
            let interval = if last_gacha.elapsed() < FAST_WINDOW { FAST } else { SLOW };
            if last_full.elapsed() < interval {
                std::thread::sleep(PROBE);
                continue;
            }
            last_full = std::time::Instant::now();
            match imp::read_once() {
                Ok(Some(frame)) => {
                    if frame.lines.iter().any(|l| { let t = l.t.replace(' ', ""); GACHA_WORDS.iter().any(|w| t.contains(w)) }) {
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
            std::thread::sleep(PROBE);
        }
    });
    Ok(())
}

/// 화면 공유(디스코드 등)에 우리 창이 보이게 할지 (사용자 2026-11-27: 디스코드 화면 공유에 창이 안 나옴).
/// 켜면 화면 찍기에서 우리 창을 빼지 않으므로, 글자를 읽기 전에 찍은 그림에서 우리 창 자리를 검게 지운다.
pub static SHARE_VISIBLE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
pub fn set_share_visible(app: AppHandle, visible: bool) {
    SHARE_VISIBLE.store(visible, Ordering::SeqCst);
    imp::apply_affinity(&app);
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
    pub fn read_regions(_profiles: &[crate::regions::Profile]) -> Result<Option<super::RegionFrame>, String> {
        Ok(None)
    }
    pub fn apply_affinity(_app: &AppHandle) {}
}

#[cfg(windows)]
mod imp {
    use super::{Frame, Line, RegionFrame};
    use tauri::{AppHandle, Manager};
    use windows::core::HSTRING;
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        BitBlt, SetStretchBltMode, StretchBlt, HALFTONE, ClientToScreen, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
        ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
    };
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, SetWindowDisplayAffinity,
        WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };

    use std::sync::atomic::{AtomicIsize, Ordering};
    /// 마지막으로 읽은 다른 프로그램 창 (우리 창이 앞에 있을 때 이어서 읽는다)
    static LAST_TARGET: AtomicIsize = AtomicIsize::new(0);

    fn err<E: std::fmt::Display>(what: &str) -> impl Fn(E) -> String + '_ {
        move |e| format!("{what}: {e}")
    }

    /// 우리 창은 화면 캡처에 안 찍히게 한다(창 글자를 게임 글자로 읽지 않게). 한국어 인식이 되는지도 확인한다.
    pub fn prepare(app: &AppHandle) -> Result<(), String> {
        apply_affinity(app);
        engine().map(|_| ())
    }

    /// 우리 창 핸들 (화면 공유에 보이게 했을 때 찍은 그림에서 이 자리를 지운다)
    static OWN: AtomicIsize = AtomicIsize::new(0);

    /// 화면 공유 설정에 맞춰 우리 창을 화면 찍기에서 뺄지 정한다
    pub fn apply_affinity(app: &AppHandle) {
        if let Some(win) = app.get_webview_window("main") {
            if let Ok(hwnd) = win.hwnd() {
                OWN.store(hwnd.0 as isize, Ordering::SeqCst);
                let mode = if super::SHARE_VISIBLE.load(Ordering::SeqCst) { WDA_NONE } else { WDA_EXCLUDEFROMCAPTURE };
                // SAFETY: 우리 창의 유효한 핸들. 실패해도(구형 윈도우) 계속한다.
                unsafe {
                    let _ = SetWindowDisplayAffinity(HWND(hwnd.0 as _), mode);
                }
            }
        }
    }

    /// 찍은 그림(창 안쪽 왼쪽 위 = origin, 배율 num/den)에서 우리 창이 겹친 자리를 검게 칠한다
    fn mask_own(buf: &mut [u8], cw: i32, ch: i32, origin: POINT, num: i32, den: i32) {
        if !super::SHARE_VISIBLE.load(Ordering::SeqCst) {
            return;
        }
        let own = HWND(OWN.load(Ordering::SeqCst) as *mut core::ffi::c_void);
        if own.0.is_null() {
            return;
        }
        let mut r = RECT::default();
        // SAFETY: 우리 창의 핸들과 유효한 출력 포인터
        unsafe {
            if !IsWindowVisible(own).as_bool() || IsIconic(own).as_bool() || GetWindowRect(own, &mut r).is_err() {
                return;
            }
        }
        let x0 = ((r.left - origin.x) * num / den).clamp(0, cw);
        let x1 = ((r.right - origin.x) * num / den).clamp(0, cw);
        let y0 = ((r.top - origin.y) * num / den).clamp(0, ch);
        let y1 = ((r.bottom - origin.y) * num / den).clamp(0, ch);
        for y in y0..y1 {
            let row = (y * cw) as usize * 4;
            for x in x0..x1 {
                let i = row + x as usize * 4;
                buf[i..i + 3].fill(0);
            }
        }
    }

    thread_local! {
        /// 글자 인식기는 만드는 데 시간이 걸려서 한 번 만들어 계속 쓴다(예전에는 읽을 때마다 새로 만들었다)
        static ENGINE: std::cell::RefCell<Option<OcrEngine>> = const { std::cell::RefCell::new(None) };
    }

    fn engine() -> Result<OcrEngine, String> {
        if let Some(e) = ENGINE.with(|c| c.borrow().clone()) {
            return Ok(e);
        }
        let e = new_engine()?;
        ENGINE.with(|c| *c.borrow_mut() = Some(e.clone()));
        Ok(e)
    }

    fn new_engine() -> Result<OcrEngine, String> {
        let lang = Language::CreateLanguage(&HSTRING::from("ko")).map_err(err("언어 설정"))?;
        if !OcrEngine::IsLanguageSupported(&lang).unwrap_or(false) {
            return Err("윈도우에 한국어 글자 인식이 설치돼 있지 않습니다 (설정 → 시간 및 언어 → 언어 → 한국어 → 언어 옵션에서 '광학 문자 인식' 추가)".into());
        }
        OcrEngine::TryCreateFromLanguage(&lang).map_err(err("글자 인식 준비"))
    }

    /// 앞에 떠 있는 창의 안쪽 영역을 찍어 BGRA 바이트로 돌려준다. 우리 창이 앞이면 None.
    /// 돌려주는 값: (그림, 그림 가로, 그림 세로, 실제 창 가로, 실제 창 세로)
    /// upscale = 창이 작으면 2배로 키워 찍기(화면 전체 글자 읽기용). 잘라 읽기는 원래 크기로 찍고 자른 부분만 키운다.
    fn capture(upscale: bool) -> Result<Option<(Vec<u8>, i32, i32, i32, i32)>, String> {
        // SAFETY: 표준 GDI 호출. 만든 DC·비트맵은 이 함수 안에서 모두 해제한다.
        unsafe {
            let mut hwnd = GetForegroundWindow();
            let mut pid = 0u32;
            if !hwnd.0.is_null() {
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
            }
            if hwnd.0.is_null() || pid == GetCurrentProcessId() {
                // 우리 창을 누르고 있는 동안에는 바로 전에 보던 창(게임)을 계속 읽는다.
                // 우리 창은 화면 찍기에서 빠지므로 게임 위에 떠 있어도 가리지 않는다.
                let last = HWND(LAST_TARGET.load(Ordering::SeqCst) as *mut core::ffi::c_void);
                if last.0.is_null() || !IsWindow(Some(last)).as_bool() || !IsWindowVisible(last).as_bool() || IsIconic(last).as_bool() {
                    return Ok(None);
                }
                hwnd = last;
            } else {
                LAST_TARGET.store(hwnd.0 as isize, Ordering::SeqCst);
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
            // 작은 글자는 글자 인식이 자주 틀리므로("헤드헌팅" → "해드현팅") 창이 작으면 2배로 키워서 찍는다.
            // 1080p 창까지 2배로 키우면(3840×2160) 글자 인식이 몇 초씩 걸려 재화가 아주 늦게 바뀌었다(사용자 PC 실기 2026-11-27)
            // → 작은 창(세로 900 미만)만 키운다. 재화 같은 작은 칸은 잘라 읽기(read_regions)가 그 부분만 키워 읽는다.
            // 다만 1배로 읽으니 숫자를 못 읽는 게임이 생겨서(PC 실기 2026-11-27) 1080p는 1.5배로 절충한다.
            let (num, den) = if upscale && h < 900 { (2, 1) } else if upscale && h < 1500 { (3, 2) } else { (1, 1) };
            let (cw, ch) = (w * num / den, h * num / den);
            let bmp = CreateCompatibleBitmap(screen, cw, ch);
            let old = SelectObject(mem, bmp.into());
            let blt = if num == den {
                BitBlt(mem, 0, 0, w, h, Some(screen), origin.x, origin.y, SRCCOPY)
            } else {
                SetStretchBltMode(mem, HALFTONE);
                StretchBlt(mem, 0, 0, cw, ch, Some(screen), origin.x, origin.y, w, h, SRCCOPY).ok()
            };
            let mut info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: cw,
                    biHeight: -ch, // 위에서 아래로
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut buf = vec![0u8; (cw as usize) * (ch as usize) * 4];
            let got = GetDIBits(mem, bmp, 0, ch as u32, Some(buf.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
            SelectObject(mem, old);
            let _ = DeleteObject(bmp.into());
            let _ = DeleteDC(mem);
            ReleaseDC(None, screen);
            blt.map_err(err("화면 찍기"))?;
            if got == 0 {
                return Err("화면을 읽지 못했습니다".into());
            }
            mask_own(&mut buf, cw, ch, origin, num, den);
            Ok(Some((buf, cw, ch, w, h)))
        }
    }

    /// BGRA 그림을 글자 인식해 줄 목록으로 (위치는 그림 대비 비율)
    fn ocr(bytes: &[u8], w: i32, h: i32) -> Result<Vec<Line>, String> {
        let writer = DataWriter::new().map_err(err("버퍼"))?;
        writer.WriteBytes(bytes).map_err(err("버퍼"))?;
        let buffer = writer.DetachBuffer().map_err(err("버퍼"))?;
        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w, h).map_err(err("그림 변환"))?;
        let result = engine()?
            .RecognizeAsync(&bitmap)
            .map_err(err("글자 인식"))?
            .get()
            .map_err(err("글자 인식"))?;
        let mut lines = Vec::new();
        for line in result.Lines().map_err(err("결과"))? {
            // 윈도우 글자 인식은 한글을 글자마다 따로 떼어 주는 일이 있다("헤 드 헌 팅").
            // 그래서 낱말 사이 간격이 글자 높이에 비해 넓을 때만 띄어쓰기로 본다.
            let (mut l, mut t, mut r, mut b) = (f64::MAX, f64::MAX, 0f64, 0f64);
            let mut text = String::new();
            let mut prev_right: Option<f64> = None;
            let mut prev_ascii = false;
            for word in line.Words().map_err(err("결과"))? {
                let rect = word.BoundingRect().map_err(err("결과"))?;
                let (x, y, ww, hh) = (rect.X as f64, rect.Y as f64, rect.Width as f64, rect.Height as f64);
                let word_text = word.Text().map_err(err("결과"))?.to_string();
                if let Some(pr) = prev_right {
                    // 낱말을 붙이는 것은 한글끼리만. 숫자·영문은 인식기가 나눈 그대로 띄운다
                    // (엔드필드: 오로베릴 숫자 옆의 세로 구분선이 "1"로 읽혀 "55025"+"1" → "550251"로 붙던 문제, 2026-11-25).
                    let ascii_pair = prev_ascii && word_text.is_ascii();
                    if ascii_pair || x - pr > hh * 0.3 {
                        text.push(' ');
                    }
                }
                prev_ascii = word_text.is_ascii();
                text.push_str(&word_text);
                prev_right = Some(x + ww);
                l = l.min(x);
                t = t.min(y);
                r = r.max(x + ww);
                b = b.max(y + hh);
            }
            if r <= l || text.is_empty() {
                continue;
            }
            lines.push(Line { t: text, x: l / w as f64, y: t / h as f64, w: (r - l) / w as f64, h: (b - t) / h as f64 });
        }
        Ok(lines)
    }

    fn now_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    /// 정해진 위치만 잘라 읽기 (DESIGN.md §4.8). 판단된 화면의 칸만 글자 인식한다.
    pub fn read_regions(profiles: &[crate::regions::Profile]) -> Result<Option<RegionFrame>, String> {
        use crate::regions::{crop, match_screen, probe_matches, probe_print, rect_px, scale_for, Image};
        let Some((bytes, w, h, win_w, win_h)) = capture(false)? else { return Ok(None) };
        let img = Image { w: w as usize, h: h as usize, px: &bytes };
        let mut frame = RegionFrame { time: now_ms(), width: win_w, height: win_h, screen: None, fields: Default::default(), tops: vec![], prints: vec![] };
        let Some((_, screen, content)) = match_screen(&img, profiles) else { return Ok(Some(frame)) };
        frame.screen = Some(screen.id.clone());
        for f in &screen.fields {
            let Some(area) = f.rect.and_then(|r| rect_px(img.w, img.h, content, r)) else { continue };
            let (mut px, cw, ch) = crop(&img, area, scale_for(area));
            let pad = (ch - (area.3 - area.1) * scale_for(area)) / 2;
            crate::regions::to_ink(&mut px, cw, ch, pad);
            // 한 칸을 못 읽어도 다른 칸은 계속 읽는다(빈칸으로 넘긴다)
            let Ok(mut lines) = ocr(&px, cw as i32, ch as i32) else {
                frame.fields.insert(f.id.clone(), String::new());
                continue;
            };
            lines.sort_by(|a, b| a.y.partial_cmp(&b.y).unwrap_or(std::cmp::Ordering::Equal));
            let text = lines.into_iter().map(|l| l.t).collect::<Vec<_>>().join(" ");
            frame.fields.insert(f.id.clone(), text);
        }
        for t in &screen.tops {
            frame.tops.push(matches!(probe_matches(&img, content, t), Some((true, _))));
            frame.prints.push(probe_print(&img, content, t));
        }
        Ok(Some(frame))
    }

    pub fn read_once() -> Result<Option<Frame>, String> {
        let Some((bytes, w, h, win_w, win_h)) = capture(true)? else { return Ok(None) };
        let lines = ocr(&bytes, w, h)?;
        let time = now_ms();
        // 띄엄띄엄 본 점들이 거의 같은 색이면 화면이 제대로 안 찍힌 것(전체 화면 전용 모드 등)
        let step = (bytes.len() / 4 / 400).max(1) * 4;
        let first = [bytes[0], bytes[1], bytes[2]];
        let blank = bytes.chunks(4).step_by(step / 4).all(|p| {
            (p[0] as i32 - first[0] as i32).abs() < 8 && (p[1] as i32 - first[1] as i32).abs() < 8 && (p[2] as i32 - first[2] as i32).abs() < 8
        });
        Ok(Some(Frame { time, landscape: w > h, lines, width: win_w, height: win_h, blank }))
    }
}
