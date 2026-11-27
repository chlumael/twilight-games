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
    /// "digits"면 숫자 칸 처리(ocr.rs read_field)
    pub kind: String,
    /// 숫자 칸 글자 사이 벌리기(글자 높이 대비). 없으면 0.25, 0이면 벌리지 않음
    pub spacing: Option<f64>,
    /// 숫자를 한 글자씩 읽기(윈도우 글자 인식이 통째로는 못 읽는 글꼴 — 림버스 광기의 4)
    #[serde(rename = "perGlyph")]
    pub per_glyph: Option<bool>,
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

}
