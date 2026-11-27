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
    read_field(img, area, f.kind == "digits", f.spacing.unwrap_or(DEFAULT_SPACING))
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

/// 숫자 칸을 한 글자씩 읽기(칸 정의 `perGlyph`, 림버스 광기): 덩어리마다 위가 열린 "4"면 4,
/// 아니면 그 덩어리만 세 번 이어 붙여 읽고 두 번 이상 나온 숫자. 한 글자라도 모르면 빈 글자(못 읽음).
fn read_digits_per_glyph(img: &crate::regions::Image, area: (usize, usize, usize, usize), scale: usize) -> String {
    use crate::ink::{glyph_columns, is_narrow_one, is_open_four, repeat_single_glyph};
    let (px, cw, ch) = prepare_field(img, area, scale, true);
    let cols = glyph_columns(&px, cw, ch);
    if cols.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    for (x0, x1) in cols {
        if is_open_four(&px, cw, ch, x0, x1) {
            out.push('4');
            continue;
        }
        // 폭이 높이의 절반도 안 되는 덩어리 = "1"(세 번 붙여도 윈도우 글자 인식이 못 읽었다)
        if is_narrow_one(&px, cw, ch, x0, x1) {
            out.push('1');
            continue;
        }
        let mut g = vec![255u8; px.len()];
        for y in 0..ch {
            let (a, b) = ((y * cw + x0) * 4, (y * cw + x1) * 4);
            g[a..b].copy_from_slice(&px[a..b]);
        }
        let Some((rp, rw, rh)) = repeat_single_glyph(&g, cw, ch) else { return String::new() };
        let t = ocr(&rp, rw as i32, rh as i32).map(join_lines).unwrap_or_default();
        let best = ('0'..='9').map(|d| (t.chars().filter(|&c| c == d).count(), d)).max();
        match best {
            Some((n, d)) if n >= 2 => out.push(d),
            _ => return String::new(),
        }
    }
    out
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
