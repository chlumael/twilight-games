//! 잘라 낸 칸을 글자 인식이 잘 읽게 손질하기: 키우기(crop) → 흰 바탕·검은 글자(to_ink) → 숫자 사이 벌리기(space_glyphs) 등.
//! regions.rs(화면 판단·위치)에서 나눔(2026-11-27, 파일 500줄 규칙). 운영체제와 상관없는 계산만 있고, 글자 인식 호출은 ocr.rs.
//! 윈도우 PC에서 src-tauri/examples/region_test.rs로 스크린샷에 시험한다.
use crate::regions::Image;

/// 잘라 읽을 때 키우는 배율의 최대
pub const MAX_SCALE: usize = 8;

/// 영역을 잘라 BGRA로. scale배(1~MAX_SCALE)로 키운다(작은 글자 인식률). 쌍선형으로 부드럽게.
/// 잘라 낸 부분을 scale배로 키우고 둘레에 여백을 붙인다.
/// 글자가 그림 가장자리에 붙어 있으면 윈도우 글자 인식이 아예 못 읽는 일이 있어서(PC 실기 2026-11-27: 재화 칸을 못 읽음)
/// 키운 높이의 절반만큼 가장자리 색(왼쪽 위 점)으로 채운다.
pub fn crop(img: &Image, area: (usize, usize, usize, usize), scale: usize) -> (Vec<u8>, usize, usize) {
    let (x0, y0, x1, y1) = area;
    let s = scale.clamp(1, MAX_SCALE);
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
    // 부드럽게 키우기(쌍선형): 가장 가까운 점 방식은 글자 가장자리가 계단처럼 깨져 "00"을 "%"로 읽었다(PC 시험 2026-11-27)
    let (sw, sh) = (x1 - x0, y1 - y0);
    for y in 0..ih {
        let fy = ((y as f64 + 0.5) / s as f64 - 0.5).clamp(0.0, (sh - 1) as f64);
        let (ya, ty) = (fy.floor() as usize, fy - fy.floor());
        let yb = (ya + 1).min(sh - 1);
        for x in 0..iw {
            let fx = ((x as f64 + 0.5) / s as f64 - 0.5).clamp(0.0, (sw - 1) as f64);
            let (xa, tx) = (fx.floor() as usize, fx - fx.floor());
            let xb = (xa + 1).min(sw - 1);
            let at = |xx: usize, yy: usize, c: usize| img.px[((y0 + yy) * img.w + (x0 + xx)) * 4 + c] as f64;
            let di = ((y + pad) * w + (x + pad)) * 4;
            for c in 0..3 {
                let top = at(xa, ya, c) * (1.0 - tx) + at(xb, ya, c) * tx;
                let bot = at(xa, yb, c) * (1.0 - tx) + at(xb, yb, c) * tx;
                out[di + c] = (top * (1.0 - ty) + bot * ty).round() as u8;
            }
            out[di + 3] = 255;
        }
    }
    (out, w, h)
}

/// 글자 인식이 잘 읽게 "흰 바탕에 검은 글자"로 바꾼다(crop이 붙인 둘레 여백 `pad`는 흰색으로).
/// 1) `auto`(숫자 칸)면 밝기를 네 가지로 재 본다: 세 색 중 가장 큰 값(검은 바탕의 빨간 숫자 — 림버스 광기, PC 실기 2026-11-27),
///    보통 밝기, 세 색 중 가장 작은 값(빨강·주황 바탕의 흰 글자), 바탕색과의 차이.
///    칸마다 글자와 바탕이 가장 뚜렷하게 둘로 갈리는 것(오츠 방식의 분리도)을 고른다. 문구 칸(`auto` 아님)은 보통 밝기만 쓴다.
/// 2) 두 무리 중 더 많은 쪽을 바탕으로 보고 흰색으로, 적은 쪽(글자)을 검정으로 만든다(어두운 바탕이면 뒤집힘).
/// 3) 경계 근처만 회색으로 부드럽게 남긴다. 완전히 흑백으로 자르면 글자 가장자리가 깨져 "00"을 "%"로 읽었고,
///    회색 바탕을 그대로 두면 "1"을 "그"로 읽었다(명방 합성옥, PC 시험 2026-11-27).
pub fn to_ink(px: &mut [u8], w: usize, h: usize, pad: usize, auto: bool) {
    let inner = |x: usize, y: usize| x >= pad && x < w - pad && y >= pad && y < h - pad;
    let ways: [fn(&[u8]) -> u8; 3] = [
        |p| p[0].max(p[1]).max(p[2]),
        |p| (0.114 * p[0] as f64 + 0.587 * p[1] as f64 + 0.299 * p[2] as f64).round() as u8,
        |p| p[0].min(p[1]).min(p[2]),
    ];
    // 네 번째 방식: 바탕색(칸 안 점들의 색별 가운데 값)과 얼마나 다른지 — 글자 색이 섞여 있을 때
    // (엔드필드 재구축: 빨강·주황 바탕에 흰 글자와 노란 숫자 "120"이 함께 있어 다른 방식으로는 노란 숫자가 바탕에 묻혔다, PC 시험 2026-11-27)
    let bg = {
        let mut ch: [Vec<u8>; 3] = [vec![], vec![], vec![]];
        for y in pad..h.saturating_sub(pad) {
            for x in pad..w.saturating_sub(pad) {
                let i = (y * w + x) * 4;
                for c in 0..3 {
                    ch[c].push(px[i + c]);
                }
            }
        }
        let mid = |v: &mut Vec<u8>| -> f64 {
            v.sort_unstable();
            v.get(v.len() / 2).copied().unwrap_or(0) as f64
        };
        [mid(&mut ch[0]), mid(&mut ch[1]), mid(&mut ch[2])]
    };
    let diff_vals: Vec<u8> = px
        .chunks(4)
        .map(|p| {
            let d: f64 = (0..3).map(|c| (p[c] as f64 - bg[c]).powi(2)).sum();
            (d.sqrt() / 3f64.sqrt()).round().min(255.0) as u8
        })
        .collect();
    // 각 방식: (분리도, 늘린 밝기, 오츠 결과, 바탕이 밝은 쪽인지)
    let mut best: Option<(f64, Vec<u8>, Otsu, bool)> = None;
    let candidates = ways.iter().map(|way| px.chunks(4).map(way).collect::<Vec<u8>>()).chain(std::iter::once(diff_vals));
    for (wi, vals) in candidates.enumerate() {
        // 문구 칸은 보통 밝기만(자동으로 고르면 엔드필드 재구축 줄의 노란 "120"이 사라졌다, PC 시험 2026-11-27)
        if !auto && wi != 1 {
            continue;
        }
        let (mut lo, mut hi) = (255u8, 0u8);
        for y in pad..h.saturating_sub(pad) {
            for x in pad..w.saturating_sub(pad) {
                let v = vals[y * w + x];
                lo = lo.min(v);
                hi = hi.max(v);
            }
        }
        if hi <= lo {
            continue;
        }
        let span = (hi - lo) as u32;
        let level: Vec<u8> = vals.iter().map(|&v| ((v.max(lo) - lo) as u32 * 255 / span).min(255) as u8).collect();
        let mut hist = [0u64; 256];
        for y in pad..h - pad {
            for x in pad..w - pad {
                hist[level[y * w + x] as usize] += 1;
            }
        }
        // 분리도에 원래 밝기 차이를 곱한다(늘리기 전 차이가 작은 방식이 잡음 때문에 뽑히지 않게)
        let o = otsu(&hist);
        let sep = o.between * (span as f64 / 255.0).powi(2);
        let total: u64 = hist.iter().sum();
        let light_bg = o.dark * 2 <= total;
        if best.as_ref().is_none_or(|b| sep > b.0) {
            best = Some((sep, level, o, light_bg));
        }
    }
    let Some((_, level, o, light_bg)) = best else {
        // 한 가지 색뿐이면(글자 없음) 모두 흰색으로
        for p in px.chunks_mut(4) {
            p[..3].fill(255);
        }
        return;
    };
    // 경계(오츠가 나눈 값 바로 위) 양쪽 24만큼만 회색, 나머지는 검정·흰색.
    // 회색 폭은 두 무리 평균까지의 거리를 넘지 않게 한다(점이 아주 적으면 바탕 점이 경계에 걸려 회색으로 남았다).
    // 참고(PC 시험 2026-11-27): 경계를 두 무리 평균의 가운데로 옮기면 림버스 광기를 "5814114"로 읽어 더 나빴다.
    let center = o.cut as f64 + 0.5;
    let half = 24f64.min(center - o.m0).min(o.m1 - center).max(0.5);
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let g = if inner(x, y) {
                let d = level[i] as f64 - center; // 양수 = 밝은 쪽
                let d = if light_bg { d } else { -d }; // 양수 = 바탕 쪽
                ((d + half) * 255.0 / (2.0 * half)).clamp(0.0, 255.0) as u8
            } else {
                255
            };
            px[i * 4..i * 4 + 3].fill(g);
        }
    }
}

/// 숫자 칸 전용: to_ink를 거친 그림에서 글자(세로로 잉크가 이어진 덩어리) 사이를 글자 높이의 `gap`배 이상으로 벌린다.
/// 붙어 있는 "00"을 윈도우 글자 인식이 "㈀"·"㈜"·"%" 한 글자로 읽었다(엔드필드 교환 칸 11400, PC 시험 2026-11-27).
/// 한글은 한 글자 안에서도 떨어진 획이 있어 쓰지 않는다(숫자 칸만).
pub fn space_glyphs(px: &[u8], w: usize, h: usize, gap: f64) -> (Vec<u8>, usize, usize) {
    let ink_col: Vec<bool> = (0..w).map(|x| (0..h).any(|y| px[(y * w + x) * 4] < 128)).collect();
    let rows: Vec<usize> = (0..h).filter(|&y| (0..w).any(|x| px[(y * w + x) * 4] < 128)).collect();
    let (Some(&top), Some(&bottom)) = (rows.first(), rows.last()) else { return (px.to_vec(), w, h) };
    let min_gap = ((bottom - top + 1) as f64 * gap).round() as usize;
    // 열 순서대로: 잉크 열은 그대로, 덩어리 사이의 빈 열 묶음은 min_gap보다 짧으면 늘린다
    let mut cols: Vec<Option<usize>> = Vec::with_capacity(w * 2); // Some(원래 열) / None(흰 열)
    let first = ink_col.iter().position(|&b| b).unwrap_or(0);
    let last = ink_col.iter().rposition(|&b| b).unwrap_or(w - 1);
    let mut x = 0;
    while x < w {
        if x > first && x <= last && !ink_col[x] {
            let start = x;
            while x <= last && !ink_col[x] {
                x += 1;
            }
            let run = x - start;
            cols.extend((start..x).map(Some));
            cols.extend(std::iter::repeat_n(None, min_gap.saturating_sub(run)));
            continue;
        }
        cols.push(Some(x));
        x += 1;
    }
    let nw = cols.len();
    let mut out = vec![255u8; nw * h * 4];
    for y in 0..h {
        for (nx, c) in cols.iter().enumerate() {
            if let Some(sx) = c {
                let (si, di) = ((y * w + sx) * 4, (y * nw + nx) * 4);
                out[di..di + 4].copy_from_slice(&px[si..si + 4]);
            }
        }
    }
    (out, nw, h)
}

/// 숫자 칸 전용: 칸의 왼쪽·오른쪽 끝에 닿은 잉크 덩어리를 지운다(흰색으로). 칸 옆 버튼·테두리가 걸린 것이다.
/// 원신 인연 칸 오른쪽 끝에 닫기 버튼 테두리가 회색 호로 걸려, 화면에 따라 "183"을 빈칸으로 읽었다(PC 실기 2026-11-27).
/// `pad` = crop이 붙인 여백(칸은 x가 pad..w-pad). 덩어리는 조금이라도 어두운(200 미만) 열로 나눈다.
/// **나머지 숫자보다 위아래로 20% 넘게 긴 덩어리만** 지운다(테두리 호는 숫자보다 길다) — 끝에 닿은 진짜 숫자까지 지우면
/// 명방 합성옥 170280이 "17028"(멀쩡해 보이는 틀린 값)이 되고 원신 원석 419가 "9"가 됐다(같은 날 시험).
pub fn drop_edge_glyphs(px: &mut [u8], w: usize, h: usize, pad: usize) {
    if w <= pad * 2 + 2 {
        return;
    }
    let cols: Vec<bool> = (0..w).map(|x| (0..h).any(|y| px[(y * w + x) * 4] < 200)).collect();
    let (left, right) = (pad, w - pad - 1);
    // 열 범위 안 잉크의 위아래 길이
    let span = |px: &[u8], from: usize, to: usize| {
        let rows: Vec<usize> = (0..h).filter(|&y| (from..=to).any(|x| px[(y * w + x) * 4] < 200)).collect();
        rows.last().map_or(0, |b| b - rows[0] + 1)
    };
    let faint = |px: &[u8], from: usize, to: usize| {
        // 나머지(이 덩어리 밖) 잉크의 높이와 비교. 나머지가 없으면 지우지 않는다
        let rest_l = (0..from).filter(|&x| cols[x]).min();
        let rest_r = (to + 1..w).filter(|&x| cols[x]).max();
        let rest = match (rest_l, rest_r) {
            (Some(a), _) if from > 0 => span(px, a, from - 1),
            (_, Some(b)) => span(px, to + 1, b),
            _ => 0,
        };
        rest > 0 && span(px, from, to) as f64 > rest as f64 * 1.2
    };
    let clear = |px: &mut [u8], from: usize, to: usize| {
        for y in 0..h {
            for x in from..=to {
                let i = (y * w + x) * 4;
                px[i..i + 3].copy_from_slice(&[255, 255, 255]);
            }
        }
    };
    if cols[right] {
        let mut a = right;
        while a > 0 && cols[a - 1] {
            a -= 1;
        }
        if a > left && faint(px, a, w - 1) {
            clear(px, a, w - 1);
        }
    }
    // 왼쪽 끝은 지우지 않는다: 원신 원석 칸에서 "41"이 아이콘 자국과 붙어 지워져 "9"가 됐다(같은 날 시험)
}

/// 숫자 칸에 글자 덩어리가 하나뿐이면(예: 허가증 "0") 그 덩어리를 세 번 이어 붙인 그림. 아니면 None.
/// 윈도우 글자 인식은 한 글자만 있는 그림을 아예 읽지 못했다(엔드필드 허가증 0, PC 시험 2026-11-27).
/// 읽은 뒤 세 글자가 모두 같을 때만 그 숫자로 인정한다(ocr.rs의 read_field).
pub fn repeat_single_glyph(px: &[u8], w: usize, h: usize) -> Option<(Vec<u8>, usize, usize)> {
    let ink_col: Vec<bool> = (0..w).map(|x| (0..h).any(|y| px[(y * w + x) * 4] < 128)).collect();
    let first = ink_col.iter().position(|&b| b)?;
    let last = ink_col.iter().rposition(|&b| b)?;
    if ink_col[first..=last].iter().any(|&b| !b) {
        return None; // 덩어리가 둘 이상
    }
    let gw = last - first + 1;
    let gap = (gw / 2).max(4);
    let nw = first + gw * 3 + gap * 2 + (w - last - 1);
    let mut out = vec![255u8; nw * h * 4];
    for y in 0..h {
        for k in 0..3 {
            for gx in 0..gw {
                let si = (y * w + first + gx) * 4;
                let di = (y * nw + first + k * (gw + gap) + gx) * 4;
                out[di..di + 4].copy_from_slice(&px[si..si + 4]);
            }
        }
    }
    Some((out, nw, h))
}

/// 오츠 방식 결과
struct Otsu {
    /// 이 값 이하가 어두운 무리
    cut: u8,
    /// 두 무리 사이 분산(클수록 뚜렷하게 갈림)
    between: f64,
    /// 어두운 무리 점 수
    dark: u64,
    /// 두 무리의 평균 밝기
    m0: f64,
    m1: f64,
}

fn otsu(hist: &[u64; 256]) -> Otsu {
    let total = hist.iter().sum::<u64>() as f64;
    let sum_all: f64 = hist.iter().enumerate().map(|(i, &c)| i as f64 * c as f64).sum();
    let mut o = Otsu { cut: 127, between: 0.0, dark: 0, m0: 0.0, m1: 255.0 };
    let (mut w0, mut sum0, mut best) = (0f64, 0f64, -1f64);
    for (t, &c) in hist.iter().enumerate() {
        w0 += c as f64;
        sum0 += t as f64 * c as f64;
        let w1 = total - w0;
        if w0 == 0.0 || w1 == 0.0 {
            continue;
        }
        let (m0, m1) = (sum0 / w0, (sum_all - sum0) / w1);
        let between = (w0 / total) * (w1 / total) * (m0 - m1) * (m0 - m1);
        if between > best {
            best = between;
            o = Otsu { cut: t as u8, between, dark: w0 as u64, m0, m1 };
        }
    }
    o
}

/// 작은 글자일수록 크게: 영역 높이가 150픽셀쯤 되도록(최대 MAX_SCALE배).
/// 예전 90(최대 4배)에서는 엔드필드 교환 칸 11400을 "114㈀"로 읽었다. 150·170·190·210·240을 1080p 스크린샷 7장(1~2픽셀 밀어 본 것 포함)으로
/// 비교해 150이 가장 적게 틀렸다(PC 시험 2026-11-27).
pub fn scale_for(area: (usize, usize, usize, usize)) -> usize {
    let h = area.3 - area.1;
    (150 / h.max(1)).clamp(1, MAX_SCALE)
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
        to_ink(&mut px, 3, 1, 0, true);
        assert_eq!(&px[0..3], &[255, 255, 255]);
        assert_eq!(&px[8..11], &[0, 0, 0]);
        // 흰 바탕 + 검은 글자는 방향 유지 (문구 칸 방식도)
        for auto in [true, false] {
            let mut px = vec![250, 250, 250, 255, 250, 250, 250, 255, 10, 10, 10, 255];
            to_ink(&mut px, 3, 1, 0, auto);
            assert_eq!(px[0], 255);
            assert_eq!(px[8], 0);
        }
        // 여백은 흰색
        let mut px = vec![0u8; 3 * 3 * 4];
        px[4 * 4] = 200; // 가운데만 밝음(여백 1)
        to_ink(&mut px, 3, 3, 1, true);
        assert_eq!(px[0], 255);
    }

    #[test]
    fn ink_removes_gray_background() {
        // 회색 바탕(200) + 조금 더 밝은 점(230) + 검은 글자 → 바탕은 흰색이 돼야 한다(명방 합성옥 칸에서 회색이 남았음)
        let mut px = vec![];
        for v in [200u8, 200, 200, 230, 200, 0, 0, 200] {
            px.extend_from_slice(&[v, v, v, 255]);
        }
        to_ink(&mut px, 8, 1, 0, true);
        assert_eq!(px[0], 255);
        assert_eq!(px[3 * 4], 255);
        assert_eq!(px[5 * 4], 0);
    }

    /// 흰 바탕 그림에 검은 세로 막대(글자 대신)를 그린다
    fn bars(w: usize, h: usize, cols: &[std::ops::Range<usize>]) -> Vec<u8> {
        let mut px = vec![255u8; w * h * 4];
        for y in 0..h {
            for r in cols {
                for x in r.clone() {
                    px[(y * w + x) * 4..(y * w + x) * 4 + 3].fill(0);
                }
            }
        }
        px
    }

    #[test]
    fn glyph_spacing_and_single_glyph() {
        // 높이 10, 막대 두 개 사이 1칸 → 0.25배면 사이가 3칸(=round(10*0.25))이 된다
        let px = bars(10, 10, &[2..4, 5..7]);
        let (out, w, _) = space_glyphs(&px, 10, 10, 0.25);
        assert_eq!(w, 12);
        let ink: Vec<bool> = (0..w).map(|x| out[x * 4] < 128).collect();
        assert_eq!(ink, [false, false, true, true, false, false, false, true, true, false, false, false]);
        // 덩어리가 둘이면 세 번 붙이지 않는다
        assert!(repeat_single_glyph(&px, 10, 10).is_none());
        // 하나면 세 번 이어 붙인다(사이 4칸)
        let one = bars(8, 4, &[3..5]);
        let (rep, rw, _) = repeat_single_glyph(&one, 8, 4).unwrap();
        let ink: Vec<bool> = (0..rw).map(|x| rep[x * 4] < 128).collect();
        assert_eq!(ink.iter().filter(|&&b| b).count(), 6);
        assert_eq!(rw, 3 + 2 * 3 + 4 * 2 + 3);
    }

    #[test]
    fn drop_edge_glyphs_only_tall_right_edge() {
        // 폭 20, 높이 20, 여백 2: 숫자(가운데 높이 6)와 오른쪽 끝에 닿은 키 큰 막대(테두리) → 막대만 지운다
        let (w, h) = (20, 20);
        let mut px = vec![255u8; w * h * 4];
        let mut paint = |xs: std::ops::Range<usize>, ys: std::ops::Range<usize>| {
            for y in ys.clone() {
                for x in xs.clone() {
                    px[(y * w + x) * 4..(y * w + x) * 4 + 3].copy_from_slice(&[0, 0, 0]);
                }
            }
        };
        paint(5..8, 7..13);
        paint(16..18, 2..18);
        let mut a = px.clone();
        drop_edge_glyphs(&mut a, w, h, 2);
        assert!(a[(10 * w + 6) * 4] < 128, "숫자는 남는다");
        assert!(a[(10 * w + 17) * 4] > 200, "테두리는 지운다");
        // 오른쪽 끝에 닿았어도 숫자와 키가 같으면 남긴다(끝자리 숫자 — 명방 합성옥 170280의 0)
        let mut b = vec![255u8; w * h * 4];
        for y in 7..13 {
            for x in (5..8).chain(15..18) {
                b[(y * w + x) * 4..(y * w + x) * 4 + 3].copy_from_slice(&[0, 0, 0]);
            }
        }
        drop_edge_glyphs(&mut b, w, h, 2);
        assert!(b[(10 * w + 16) * 4] < 128);
    }

    #[test]
    fn scale_targets_150px() {
        // 1080p 재화 칸(높이 30px) → 5배, 문구 줄(23px) → 6배, 큰 칸은 1배
        assert_eq!(scale_for((0, 0, 100, 30)), 5);
        assert_eq!(scale_for((0, 0, 100, 23)), 6);
        assert_eq!(scale_for((0, 0, 100, 200)), 1);
        assert_eq!(scale_for((0, 0, 100, 5)), MAX_SCALE);
    }
}
