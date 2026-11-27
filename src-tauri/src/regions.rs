//! 정해진 위치만 잘라 읽기 (DESIGN.md §4.8 규칙 3·5). 운영체제와 상관없는 계산만 모았다(그림 자르기, 모양 지문).
//! 화면 위치·지문 값은 data/screens/*.json에 있고, 화면(웹)이 시작할 때 넘겨준다.
//! 지문 계산은 scripts/screens/feature.py와 똑같아야 한다(스크린샷에서 값을 만들 때 그 스크립트를 쓴다).
use serde::Deserialize;

pub type Rect = [f64; 4];

#[derive(Deserialize, Clone, Debug)]
pub struct Probe {
    pub rect: Option<Rect>,
    pub hash: Option<String>,
    pub rgb: Option<[u8; 3]>,
    #[serde(rename = "maxDistance")]
    pub max_distance: Option<u32>,
    #[serde(rename = "maxColor")]
    pub max_color: Option<u32>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct FieldDef {
    pub id: String,
    pub rect: Option<Rect>,
    #[allow(dead_code)]
    pub kind: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct ScreenDef {
    pub id: String,
    #[allow(dead_code)]
    pub kind: String,
    #[serde(default)]
    pub detect: Vec<Probe>,
    #[serde(default)]
    pub tops: Vec<Probe>,
    #[serde(default)]
    pub fields: Vec<FieldDef>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct Profile {
    #[allow(dead_code)]
    pub game: String,
    pub aspect: Option<f64>,
    pub screens: Vec<ScreenDef>,
}

/// BGRA 그림 (위에서 아래로)
pub struct Image<'a> {
    pub w: usize,
    pub h: usize,
    pub px: &'a [u8],
}

/// 창 안의 게임 화면 영역 (x, y, 너비, 높이; 픽셀). 창 비율이 다르면 가운데 aspect 비율 영역.
pub fn content_rect(w: usize, h: usize, aspect: Option<f64>) -> (f64, f64, f64, f64) {
    let (w, h) = (w as f64, h as f64);
    match aspect {
        Some(a) if a > 0.0 && h > 0.0 => {
            if w / h > a {
                let cw = h * a;
                ((w - cw) / 2.0, 0.0, cw, h)
            } else {
                let ch = w / a;
                (0.0, (h - ch) / 2.0, w, ch)
            }
        }
        _ => (0.0, 0.0, w, h),
    }
}

/// 비율 위치 → 픽셀 범위 [x0, x1) × [y0, y1). 너무 작으면 None
pub fn rect_px(img_w: usize, img_h: usize, content: (f64, f64, f64, f64), r: Rect) -> Option<(usize, usize, usize, usize)> {
    let (cx, cy, cw, ch) = content;
    let x0 = (cx + r[0] * cw).round().max(0.0) as usize;
    let y0 = (cy + r[1] * ch).round().max(0.0) as usize;
    let x1 = ((cx + (r[0] + r[2]) * cw).round() as usize).min(img_w);
    let y1 = ((cy + (r[1] + r[3]) * ch).round() as usize).min(img_h);
    if x1 <= x0 + 1 || y1 <= y0 + 1 {
        return None;
    }
    Some((x0, y0, x1, y1))
}

fn gray(p: &[u8]) -> f64 {
    // BGRA
    0.114 * p[0] as f64 + 0.587 * p[1] as f64 + 0.299 * p[2] as f64
}

/// 모양 지문: 영역을 8×8 칸으로 나눠 칸마다 평균 밝기 → 전체 평균 이상이면 1. 16자리 16진수(왼쪽 위부터).
/// 그리고 영역의 평균 색 [R, G, B].
pub fn feature(img: &Image, area: (usize, usize, usize, usize)) -> (String, [u8; 3]) {
    let (x0, y0, x1, y1) = area;
    let mut cells = [0f64; 64];
    for cy in 0..8 {
        for cx in 0..8 {
            let ax = x0 + (x1 - x0) * cx / 8;
            let bx = (x0 + (x1 - x0) * (cx + 1) / 8).max(ax + 1);
            let ay = y0 + (y1 - y0) * cy / 8;
            let by = (y0 + (y1 - y0) * (cy + 1) / 8).max(ay + 1);
            let (mut sum, mut n) = (0f64, 0f64);
            for y in ay..by.min(img.h) {
                for x in ax..bx.min(img.w) {
                    let i = (y * img.w + x) * 4;
                    sum += gray(&img.px[i..i + 4]);
                    n += 1.0;
                }
            }
            cells[cy * 8 + cx] = if n > 0.0 { sum / n } else { 0.0 };
        }
    }
    let mean = cells.iter().sum::<f64>() / 64.0;
    let mut bits: u64 = 0;
    for (i, v) in cells.iter().enumerate() {
        if *v >= mean {
            bits |= 1 << (63 - i);
        }
    }
    let (mut r, mut g, mut b, mut n) = (0u64, 0u64, 0u64, 0u64);
    for y in y0..y1 {
        for x in x0..x1 {
            let i = (y * img.w + x) * 4;
            b += img.px[i] as u64;
            g += img.px[i + 1] as u64;
            r += img.px[i + 2] as u64;
            n += 1;
        }
    }
    let n = n.max(1);
    (format!("{bits:016x}"), [(r / n) as u8, (g / n) as u8, (b / n) as u8])
}

pub fn hamming(a: &str, b: &str) -> u32 {
    match (u64::from_str_radix(a, 16), u64::from_str_radix(b, 16)) {
        (Ok(x), Ok(y)) => (x ^ y).count_ones(),
        _ => 64,
    }
}

/// 작은 부분이 정해진 모양·색과 맞는지. 정해지지 않은 부분(빈칸)은 맞지 않는 것으로 본다.
pub fn probe_matches(img: &Image, content: (f64, f64, f64, f64), p: &Probe) -> Option<(bool, String)> {
    let (rect, hash, rgb) = (p.rect?, p.hash.as_ref()?, p.rgb?);
    let area = rect_px(img.w, img.h, content, rect)?;
    let (h, c) = feature(img, area);
    let dist = hamming(&h, hash);
    let color = (c[0] as i32 - rgb[0] as i32).unsigned_abs()
        + (c[1] as i32 - rgb[1] as i32).unsigned_abs()
        + (c[2] as i32 - rgb[2] as i32).unsigned_abs();
    Some((dist <= p.max_distance.unwrap_or(10) && color <= p.max_color.unwrap_or(40), h))
}

/// 결과 화면 등급 칸의 지문만 (같은 화면 두 번 세기 방지용)
pub fn probe_print(img: &Image, content: (f64, f64, f64, f64), p: &Probe) -> String {
    p.rect
        .and_then(|r| rect_px(img.w, img.h, content, r))
        .map(|a| feature(img, a).0)
        .unwrap_or_default()
}

/// 영역을 잘라 BGRA로. scale배(1~4)로 키운다(작은 글자 인식률). 가장 가까운 점 방식.
/// 잘라 낸 부분을 scale배로 키우고 둘레에 여백을 붙인다.
/// 글자가 그림 가장자리에 붙어 있으면 윈도우 글자 인식이 아예 못 읽는 일이 있어서(PC 실기 2026-11-27: 재화 칸을 못 읽음)
/// 키운 높이의 절반만큼 가장자리 색(왼쪽 위 점)으로 채운다.
pub fn crop(img: &Image, area: (usize, usize, usize, usize), scale: usize) -> (Vec<u8>, usize, usize) {
    let (x0, y0, x1, y1) = area;
    let s = scale.clamp(1, 4);
    let (iw, ih) = ((x1 - x0) * s, (y1 - y0) * s);
    let pad = ih / 2;
    let (w, h) = (iw + pad * 2, ih + pad * 2);
    let edge = {
        let i = (y0 * img.w + x0) * 4;
        [img.px[i], img.px[i + 1], img.px[i + 2], 255]
    };
    let mut out = vec![0u8; w * h * 4];
    for px in out.chunks_mut(4) {
        px.copy_from_slice(&edge);
    }
    for y in 0..ih {
        for x in 0..iw {
            let si = ((y0 + y / s) * img.w + (x0 + x / s)) * 4;
            let di = ((y + pad) * w + (x + pad)) * 4;
            out[di..di + 4].copy_from_slice(&img.px[si..si + 4]);
        }
    }
    (out, w, h)
}

/// 글자 인식이 잘 읽게 "흰 바탕에 검은 글자"로 바꾼다(crop이 붙인 둘레 여백 `pad`는 흰색으로).
/// 밝기 대신 세 색 중 가장 큰 값을 써서, 검은 바탕의 빨간 숫자(림버스 광기)도 바탕과 뚜렷하게 갈린다(PC 실기 2026-11-27: 광기를 못 읽음).
/// 가장 어두운 곳~가장 밝은 곳을 0~255로 늘리고, 칸 안이 대체로 어두우면(어두운 바탕에 밝은 글자) 뒤집는다.
pub fn to_ink(px: &mut [u8], w: usize, h: usize, pad: usize) {
    let inner = |x: usize, y: usize| x >= pad && x < w - pad && y >= pad && y < h - pad;
    let vals: Vec<u8> = px.chunks(4).map(|p| p[0].max(p[1]).max(p[2])).collect();
    let (mut lo, mut hi, mut sum, mut n) = (255u8, 0u8, 0u64, 0u64);
    for y in 0..h {
        for x in 0..w {
            if inner(x, y) {
                let v = vals[y * w + x];
                lo = lo.min(v);
                hi = hi.max(v);
                sum += v as u64;
                n += 1;
            }
        }
    }
    if n == 0 {
        return;
    }
    // 한 가지 색뿐이면(글자 없음) 칸 안은 흰색으로
    let invert = hi > lo && (sum / n) < ((lo as u64 + hi as u64) / 2);
    let span = (hi - lo).max(1) as u32;
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let g = if inner(x, y) {
                let n = ((vals[i] - lo) as u32 * 255 / span).min(255) as u8;
                if hi == lo { 255 } else if invert { 255 - n } else { n }
            } else {
                255
            };
            px[i * 4..i * 4 + 3].fill(g);
        }
    }
}

/// 작은 글자일수록 크게: 영역 높이가 90픽셀쯤 되도록(최대 4배). 60이면 1080p 재화 칸(30~40픽셀)이 그대로 1배라 작았다(2026-11-27)
pub fn scale_for(area: (usize, usize, usize, usize)) -> usize {
    let h = area.3 - area.1;
    (90 / h.max(1)).clamp(1, 4)
}

/// 화면 판단: 판단 부분이 모두 정해져 있고 모두 맞는 첫 화면
pub fn match_screen<'p>(img: &Image, profiles: &'p [Profile]) -> Option<(&'p Profile, &'p ScreenDef, (f64, f64, f64, f64))> {
    for p in profiles {
        let content = content_rect(img.w, img.h, p.aspect);
        for s in &p.screens {
            if s.detect.is_empty() {
                continue;
            }
            let ok = s.detect.iter().all(|d| matches!(probe_matches(img, content, d), Some((true, _))));
            if ok {
                return Some((p, s, content));
            }
        }
    }
    None
}

/// 판단 가능한 화면이 하나라도 있는지 (없으면 잘라 읽기를 하지 않는다)
pub fn any_ready(profiles: &[Profile]) -> bool {
    profiles
        .iter()
        .any(|p| p.screens.iter().any(|s| !s.detect.is_empty() && s.detect.iter().all(|d| d.rect.is_some() && d.hash.is_some() && d.rgb.is_some())))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn checker(w: usize, h: usize) -> Vec<u8> {
        // 왼쪽 절반 흰색, 오른쪽 절반 검정
        let mut v = vec![0u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let c = if x < w / 2 { 255 } else { 0 };
                let i = (y * w + x) * 4;
                v[i] = c;
                v[i + 1] = c;
                v[i + 2] = c;
                v[i + 3] = 255;
            }
        }
        v
    }

    #[test]
    fn content_rect_letterbox() {
        assert_eq!(content_rect(1920, 1080, Some(16.0 / 9.0)), (0.0, 0.0, 1920.0, 1080.0));
        let (x, _, w, _) = content_rect(2560, 1080, Some(16.0 / 9.0));
        assert_eq!((x, w), (320.0, 1920.0));
        let (_, y, _, h) = content_rect(1920, 1200, Some(16.0 / 9.0));
        assert_eq!((y, h), (60.0, 1080.0));
    }

    #[test]
    fn feature_matches_python_script() {
        // scripts/screens/feature.py 의 self_test와 같은 입력·같은 답
        let px = checker(16, 16);
        let img = Image { w: 16, h: 16, px: &px };
        let (h, rgb) = feature(&img, (0, 0, 16, 16));
        assert_eq!(h, "f0f0f0f0f0f0f0f0");
        assert_eq!(rgb, [127, 127, 127]);
        assert_eq!(hamming("f0f0f0f0f0f0f0f0", "f0f0f0f0f0f0f0f1"), 1);
    }

    #[test]
    fn crop_scales() {
        let px = checker(16, 16);
        let img = Image { w: 16, h: 16, px: &px };
        let (out, w, h) = crop(&img, (6, 0, 10, 2), 2);
        // 8×4로 키운 것 + 둘레 여백 2(키운 높이의 절반)
        assert_eq!((w, h), (12, 8));
        let at = |x: usize, y: usize| out[(y * w + x) * 4];
        assert_eq!(at(2, 2), 255);
        assert_eq!(at(9, 2), 0);
        // 여백은 가장자리 색(왼쪽 위 점)
        assert_eq!(at(0, 0), at(2, 2));
    }

    #[test]
    fn ink_makes_dark_text_on_white() {
        // 1×3 칸(여백 0): 검정, 검정, 빨강 → 흰 바탕 + 검은 글자
        let mut px = vec![0, 0, 0, 255, 0, 0, 0, 255, 40, 40, 220, 255]; // BGRA
        to_ink(&mut px, 3, 1, 0);
        assert_eq!(&px[0..3], &[255, 255, 255]);
        assert_eq!(&px[8..11], &[0, 0, 0]);
        // 흰 바탕 + 검은 글자는 방향 유지
        let mut px = vec![250, 250, 250, 255, 250, 250, 250, 255, 10, 10, 10, 255];
        to_ink(&mut px, 3, 1, 0);
        assert_eq!(px[0], 255);
        assert_eq!(px[8], 0);
        // 여백은 흰색
        let mut px = vec![0u8; 3 * 3 * 4];
        px[4 * 4] = 200; // 가운데만 밝음(여백 1)
        to_ink(&mut px, 3, 3, 1);
        assert_eq!(px[0], 255);
    }
}
