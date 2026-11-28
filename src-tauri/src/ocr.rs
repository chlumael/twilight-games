//! 윈도우 내장 글자 인식(Windows.Media.Ocr, 한국어)과 "칸 하나 읽기".
//! 앱(screen.rs)과 시험 도구(examples/region_test.rs)가 같은 코드를 쓰도록 tauri와 상관없이 모았다.
//! 시험 도구는 `#[path]`로 이 파일과 regions.rs를 그대로 가져다 쓴다.
use serde::Serialize;

/// 읽은 줄 하나 (위치는 그림 대비 비율)
#[derive(Serialize, Clone, Debug)]
pub struct Line {
    pub t: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[cfg(windows)]
pub use win::*;

#[cfg(windows)]
mod win {
use super::Line;
use windows::core::HSTRING;
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;

fn err<E: std::fmt::Display>(what: &str) -> impl Fn(E) -> String + '_ {
    move |e| format!("{what}: {e}")
}

thread_local! {
    /// 글자 인식기는 만드는 데 시간이 걸려서 한 번 만들어 계속 쓴다(예전에는 읽을 때마다 새로 만들었다)
    static ENGINE: std::cell::RefCell<Option<OcrEngine>> = const { std::cell::RefCell::new(None) };
}

pub fn engine() -> Result<OcrEngine, String> {
    if let Some(e) = ENGINE.with(|c| c.borrow().clone()) {
        return Ok(e);
    }
    let e = engine_for("ko").map_err(|_| "윈도우에 한국어 글자 인식이 설치돼 있지 않습니다 (설정 → 시간 및 언어 → 언어 → 한국어 → 언어 옵션에서 '광학 문자 인식' 추가)".to_string())?;
    ENGINE.with(|c| *c.borrow_mut() = Some(e.clone()));
    Ok(e)
}

/// 언어를 정해 글자 인식기 만들기 (시험 도구에서 언어별로 비교할 때)
pub fn engine_for(tag: &str) -> Result<OcrEngine, String> {
    let lang = Language::CreateLanguage(&HSTRING::from(tag)).map_err(err("언어 설정"))?;
    if !OcrEngine::IsLanguageSupported(&lang).unwrap_or(false) {
        return Err(format!("{tag} 글자 인식 없음"));
    }
    OcrEngine::TryCreateFromLanguage(&lang).map_err(err("글자 인식 준비"))
}

/// BGRA 그림을 글자 인식해 줄 목록으로 (위치는 그림 대비 비율)
pub fn ocr(bytes: &[u8], w: i32, h: i32) -> Result<Vec<Line>, String> {
    ocr_with(&engine()?, bytes, w, h)
}

pub fn ocr_with(engine: &OcrEngine, bytes: &[u8], w: i32, h: i32) -> Result<Vec<Line>, String> {
    let writer = DataWriter::new().map_err(err("버퍼"))?;
    writer.WriteBytes(bytes).map_err(err("버퍼"))?;
    let buffer = writer.DetachBuffer().map_err(err("버퍼"))?;
    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w, h).map_err(err("그림 변환"))?;
    let result = engine
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

/// 칸 하나 읽기: 자르기(키우기+여백) → 흰 바탕·검은 글자 → 글자 인식 → 위에서 아래 순서로 이어 붙인 글자.
/// 읽지 못하면 빈 글자.
/// 칸 정의에 맞춰 읽기 (앱과 시험 도구가 함께 쓴다)
pub fn read_def(img: &crate::regions::Image, area: (usize, usize, usize, usize), f: &crate::regions::FieldDef) -> String {
    if f.kind == "digits" && f.per_glyph == Some(true) {
        return read_digits_per_glyph(img, area, crate::ink::scale_for(area));
    }
    let text = read_field(img, area, f.kind == "digits", f.spacing.unwrap_or(DEFAULT_SPACING));
    if f.kind == "digits" && f.slashed_zero == Some(true) {
        return fix_slashed_zeros(img, area, text);
    }
    text
}

/// 빗금 친 0(Ø) 자리를 0으로 바꾼다(칸 정의 `slashedZero`, 명일방주). 읽은 글자 수(띄어쓰기 빼고)가 글자 덩어리 수와 같을 때만
/// — 자리를 확실히 맞출 수 있을 때만 고친다(PC 실기 2026-11-27: 171020 → "171022", 170280 → "17028험").
fn fix_slashed_zeros(img: &crate::regions::Image, area: (usize, usize, usize, usize), text: String) -> String {
    use crate::glyphs::{glyph_columns, is_slashed_zero};
    let (px, cw, ch) = prepare_field(img, area, crate::ink::scale_for(area), true);
    let cols = glyph_columns(&px, cw, ch);
    let mut chars: Vec<char> = text.chars().filter(|c| !c.is_whitespace()).collect();
    if chars.len() != cols.len() {
        return text;
    }
    for (i, &(x0, x1)) in cols.iter().enumerate() {
        if is_slashed_zero(&px, cw, ch, x0, x1) {
            chars[i] = '0';
        }
    }
    chars.into_iter().collect()
}

/// 숫자 칸 글자 사이 벌리기 기본값(글자 높이의 0.25배) — PC 시험 2026-11-27: 원신 인연 183·명방 합성옥 170280이 이때 맞음
pub const DEFAULT_SPACING: f64 = 0.25;

/// `digits` = 숫자 칸(글자 사이를 `spacing`배로 벌리고, 한 글자뿐이면 세 번 이어 붙여 읽는다).
pub fn read_field(img: &crate::regions::Image, area: (usize, usize, usize, usize), digits: bool, spacing: f64) -> String {
    let s = crate::ink::scale_for(area);
    if !digits {
        let (px, cw, ch) = prepare_field(img, area, s, false);
        return ocr(&px, cw as i32, ch as i32).map(join_lines).unwrap_or_default();
    }
    // 참고(PC 시험 2026-11-27): 배율 두 가지로 읽어 같을 때만 인정하는 방법도 해 봤지만,
    // 맞는 값(58414, 11400)은 버리고 틀린 값(명방 Ø를 2로 읽은 170282)은 두 배율 모두 같게 틀려서 효과가 없었다.
    read_digits_at(img, area, s, spacing)
}

/// 숫자 칸 한 번 읽기(정한 배율로)
fn read_digits_at(img: &crate::regions::Image, area: (usize, usize, usize, usize), scale: usize, spacing: f64) -> String {
    use crate::ink::{repeat_single_glyph, space_glyphs};
    let (px, cw, ch) = prepare_field(img, area, scale, true);
    if let Some((rp, rw, rh)) = repeat_single_glyph(&px, cw, ch) {
        // 같은 글자 세 개로 읽혀야 그 한 글자로 인정
        let t: String = ocr(&rp, rw as i32, rh as i32).map(join_lines).unwrap_or_default().chars().filter(|c| !c.is_whitespace()).collect();
        let mut cs = t.chars();
        return match (cs.next(), cs.next(), cs.next(), cs.next()) {
            (Some(a), Some(b), Some(c), None) if a == b && b == c && a.is_ascii_digit() => a.to_string(),
            _ => String::new(),
        };
    }
    if spacing <= 0.0 {
        return ocr(&px, cw as i32, ch as i32).map(join_lines).unwrap_or_default();
    }
    let (sp, sw, sh) = space_glyphs(&px, cw, ch, spacing);
    ocr(&sp, sw as i32, sh as i32).map(join_lines).unwrap_or_default()
}

/// 숫자 칸을 덩어리별로 읽기(칸 정의 `perGlyph`, 림버스 광기):
/// 1) 위가 열린 "4"와 좁은 "1"은 모양으로 정한다(윈도우 글자 인식이 이 글꼴의 4를 못 읽고, 1은 따로 떼면 못 읽음).
/// 2) 나머지 덩어리만 남긴 그림을 한 번에 읽어(5·8 같은 숫자는 함께 읽으면 잘 읽힌다) 왼쪽부터 자리에 넣는다.
///    덩어리를 하나씩 세 번 붙여 읽던 방식은 "8"을 어떤 때는 "88B", 어떤 때는 빈칸으로 읽어서 바꿨다(PC 실기 2026-11-27).
/// 읽은 숫자 개수가 남긴 덩어리 수와 다르면 빈 글자(못 읽음 — 틀린 값을 넣지 않는다).
fn read_digits_per_glyph(img: &crate::regions::Image, area: (usize, usize, usize, usize), scale: usize) -> String {
    use crate::glyphs::{glyph_columns, is_narrow_one, is_open_four};
    let (px, cw, ch) = prepare_field(img, area, scale, true);
    let cols = glyph_columns(&px, cw, ch);
    if cols.is_empty() {
        return String::new();
    }
    let known: Vec<Option<char>> = cols
        .iter()
        .map(|&(x0, x1)| if is_open_four(&px, cw, ch, x0, x1) { Some('4') } else if is_narrow_one(&px, cw, ch, x0, x1) { Some('1') } else { None })
        .collect();
    let unknown = known.iter().filter(|k| k.is_none()).count();
    let mut read: Vec<char> = vec![];
    if unknown > 0 {
        // 모양으로 정하지 못한 덩어리만 붙여 놓고 그 묶음을 세 번 이어 붙여 읽는다("58" → "58 58 58").
        // 세 묶음이 모두 같을 때만 인정
        let rest: Vec<(usize, usize)> = cols.iter().zip(&known).filter(|(_, k)| k.is_none()).map(|(&c, _)| c).collect();
        let gw = rest.iter().map(|(a, b)| b - a).max().unwrap_or(1);
        let (g, gw2, gh) = crate::glyphs::compose(&px, cw, ch, &rest, 3, (gw / 4).max(2), gw * 2);
        let t: String = ocr(&g, gw2 as i32, gh as i32).map(join_lines).unwrap_or_default().chars().filter(|c| !c.is_whitespace()).collect();
        let cs: Vec<char> = t.chars().collect();
        if cs.len() != unknown * 3 || !cs.iter().all(|c| c.is_ascii_digit()) {
            return String::new();
        }
        let (a, b, c) = (&cs[..unknown], &cs[unknown..unknown * 2], &cs[unknown * 2..]);
        if a != b || b != c {
            return String::new();
        }
        read = a.to_vec();
    }
    let mut it = read.into_iter();
    known.into_iter().map(|k| k.or_else(|| it.next()).unwrap_or('?')).collect()
}

/// 화면 전체 글자 중 "날짜는 있는데 시각(hh:mm:ss)이 깨진" 줄만 그 자리를 잘라 크게 키워 다시 읽는다.
/// PC 실기(2026-11-28, 엔드필드 헤드헌팅 기록): 화면 전체 읽기가 "05:41:09"를 매번 "0541刀9"로 읽어 그 기록 줄이 계속 빠졌다.
/// 다시 읽은 글자에 시각이 제대로 있을 때만 바꾼다.
pub fn reread_time_lines(img: &crate::regions::Image, lines: &mut [Line]) {
    let has_date = |t: &str| {
        let d: String = t.chars().filter(|c| !c.is_whitespace()).collect();
        let b = d.as_bytes();
        b.len() >= 10 && b[..4].iter().all(u8::is_ascii_digit) && (b[4] == b'.' || b[4] == b',')
    };
    let good_time = |t: &str| {
        let c: Vec<char> = t.chars().collect();
        c.windows(8).any(|w| w[2] == ':' && w[5] == ':' && [0, 1, 3, 4, 6, 7].iter().all(|&i| w[i].is_ascii_digit()))
    };
    // 다시 읽은 글자는 시각 조각(마지막 낱말)이 숫자 6개 + 콜론 대신 읽힌 기호(숫자 아닌 글자 0~2개)면 받는다
    // (예: "0541!09" — 화면 쪽 규칙 history.ts looseClock이 시·분·초로 나눈다)
    let usable = |t: &str| {
        good_time(t) || t.split_whitespace().last().is_some_and(|w| {
            let n = w.chars().count();
            (6..=8).contains(&n) && w.chars().filter(|c| c.is_ascii_digit()).count() == 6 && w.chars().filter(|c| !c.is_ascii_digit()).count() == n - 6
        })
    };
    for l in lines.iter_mut() {
        if !has_date(&l.t) || good_time(&l.t) {
            continue;
        }
        // 줄 자리(비율) → 픽셀, 위아래로 조금 넓혀서
        let (w, h) = (img.w as f64, img.h as f64);
        let x0 = ((l.x - 0.005) * w).max(0.0) as usize;
        let x1 = (((l.x + l.w + 0.005) * w) as usize).min(img.w);
        let y0 = ((l.y - l.h * 0.3) * h).max(0.0) as usize;
        let y1 = (((l.y + l.h * 1.3) * h) as usize).min(img.h);
        if x1 <= x0 + 4 || y1 <= y0 + 4 {
            continue;
        }
        // 1) 줄 끝의 "hh:mm:ss"를 글자 덩어리로 나눠 콜론 둘을 빼고 숫자 6개만 붙여 읽는다(콜론과 0이 붙어 "2223•℃7"로 읽히던 것)
        if let Some(clock) = read_clock(img, (x0, y0, x1, y1)) {
            let date = l.t.trim_end().rsplit_once(char::is_whitespace).map(|(d, _)| d.to_string()).unwrap_or_default();
            if has_date(&date) {
                l.t = format!("{date} {clock}");
                continue;
            }
        }
        // 2) 안 되면 그 줄을 크게 키워 통째로 다시 읽는다
        let t = read_field(img, (x0, y0, x1, y1), false, DEFAULT_SPACING);
        if usable(&t) && has_date(&t) {
            l.t = t;
        }
    }
}

/// 줄 끝의 시각 "hh:mm:ss": 마지막 덩어리 8개 중 3·6번째가 콜론이면 나머지 숫자 6개만 붙여 읽는다. 숫자 6개로 읽힐 때만 "hh:mm:ss"
fn read_clock(img: &crate::regions::Image, area: (usize, usize, usize, usize)) -> Option<String> {
    use crate::glyphs::{compose, glyph_columns, is_colon};
    let scale = crate::ink::scale_for(area).max(3);
    let (px, cw, ch) = prepare_field(img, area, scale, true);
    let cols = glyph_columns(&px, cw, ch);
    if cols.len() < 8 {
        return None;
    }
    let last = &cols[cols.len() - 8..];
    let digit_w = [0, 1, 3, 4, 6, 7].iter().map(|&i| last[i].1 - last[i].0).max().unwrap_or(1);
    if !is_colon(&px, cw, ch, last[2].0, last[2].1, digit_w) || !is_colon(&px, cw, ch, last[5].0, last[5].1, digit_w) {
        return None;
    }
    let digits: Vec<(usize, usize)> = [0, 1, 3, 4, 6, 7].iter().map(|&i| last[i]).collect();
    let (g, gw, gh) = compose(&px, cw, ch, &digits, 1, (digit_w / 4).max(2), 0);
    let t: String = ocr(&g, gw as i32, gh as i32).map(join_lines).unwrap_or_default().chars().filter(|c| !c.is_whitespace()).collect();
    let d: Vec<u32> = t.chars().filter_map(|c| c.to_digit(10)).collect();
    if t.chars().count() != 6 || d.len() != 6 {
        return None;
    }
    let (hh, mm, ss) = (d[0] * 10 + d[1], d[2] * 10 + d[3], d[4] * 10 + d[5]);
    (hh <= 23 && mm <= 59 && ss <= 59).then(|| format!("{hh:02}:{mm:02}:{ss:02}"))
}

/// 엔드필드 헤드헌팅 기록: 날짜 줄은 있는데 같은 줄의 이름 칸("이름" 머리글 아래)이 비었으면 그 칸을 잘라 다시 읽는다.
/// 윈도우 글자 인식은 한 글자 이름("판")을 못 읽어서(PC 실기 2026-11-28) 한 덩어리면 세 번 이어 붙여 읽고 셋이 같을 때만 받는다.
pub fn reread_name_cells(img: &crate::regions::Image, lines: &mut Vec<Line>) {
    let Some(head) = lines.iter().find(|l| l.t.trim() == "이름").cloned() else { return };
    let dates: Vec<Line> = lines
        .iter()
        .filter(|l| l.y > head.y + 0.02 && l.x > head.x + 0.05 && l.t.chars().take(4).all(|c| c.is_ascii_digit()))
        .cloned()
        .collect();
    let (w, h) = (img.w as f64, img.h as f64);
    for d in dates {
        let cx = head.x + head.w / 2.0;
        // 한글이 있는 조각이 있어야 채워진 것("NEW!"만 읽힌 6성 줄은 비어 있는 것으로 보고 다시 읽는다)
        let filled = lines.iter().any(|l| {
            (l.y - d.y).abs() < 0.02 && l.x < d.x - 0.02 && l.x + l.w > cx - 0.06 && l.x < cx + 0.06 && l.t.chars().any(|c| ('가'..='힣').contains(&c))
        });
        if filled {
            continue;
        }
        let (x0, x1) = (((cx - 0.08) * w).max(0.0) as usize, (((cx + 0.08) * w) as usize).min(img.w));
        // 날짜 줄은 글자가 작아(높이 0.01) 이름 칸 높이는 화면 높이의 3.5%로 잡는다(이름 글자 0.02 + 여유)
        let mid = d.y + d.h / 2.0;
        let (y0, y1) = (((mid - 0.0175) * h).max(0.0) as usize, (((mid + 0.0175) * h) as usize).min(img.h));
        if x1 <= x0 + 4 || y1 <= y0 + 4 {
            continue;
        }
        // 한 덩어리(한 글자)면 세 번 이어 붙여 읽는다. 배율에 따라 읽혔다 안 읽혔다 해서(1배 화면 "판" 성공, 1.5배 실패) 몇 가지 배율로 시도
        let mut t = String::new();
        for scale in [2usize, 3, 4, 5, 1] {
            let (px, cw, ch) = prepare_field(img, (x0, y0, x1, y1), scale, false);
            t = match crate::ink::repeat_single_glyph(&px, cw, ch) {
                Some((rp, rw, rh)) => {
                    let r: Vec<char> = ocr(&rp, rw as i32, rh as i32).map(join_lines).unwrap_or_default().chars().filter(|c| !c.is_whitespace()).collect();
                    if r.len() == 3 && r[0] == r[1] && r[1] == r[2] && ('가'..='힣').contains(&r[0]) { r[0].to_string() } else { String::new() }
                }
                None => ocr(&px, cw as i32, ch as i32).map(join_lines).unwrap_or_default(),
            };
            if t.chars().any(|c| ('가'..='힣').contains(&c)) {
                break;
            }
        }
        if t.chars().any(|c| ('가'..='힣').contains(&c)) {
            lines.push(Line { t, x: cx - 0.02, y: d.y, w: 0.04, h: d.h });
        }
    }
}

/// 글자 인식에 넘길 그림: 자르기(scale배 + 여백) → 흰 바탕·검은 글자 (`digits` = 숫자 칸: 밝기 재는 방식을 칸마다 고름)
pub fn prepare_field(img: &crate::regions::Image, area: (usize, usize, usize, usize), scale: usize, digits: bool) -> (Vec<u8>, usize, usize) {
    use crate::ink::{crop, drop_edge_glyphs, to_ink};
    let (mut px, cw, ch) = crop(img, area, scale);
    let pad = (ch - (area.3 - area.1) * scale.clamp(1, crate::ink::MAX_SCALE)) / 2;
    to_ink(&mut px, cw, ch, pad, digits);
    if digits {
        drop_edge_glyphs(&mut px, cw, ch, pad);
    }
    (px, cw, ch)
}

/// 읽은 줄을 위에서 아래 순서로 이어 붙인다
pub fn join_lines(mut lines: Vec<Line>) -> String {
    lines.sort_by(|a, b| a.y.partial_cmp(&b.y).unwrap_or(std::cmp::Ordering::Equal));
    lines.into_iter().map(|l| l.t).collect::<Vec<_>>().join(" ")
}
}
