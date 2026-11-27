//! 숫자 글자 덩어리의 모양 판단(윈도우 글자 인식이 못 읽는 글꼴용). ink.rs에서 나눔(2026-11-27, 파일 500줄 규칙).
//! 림버스 광기: 윈도우 글자 인식이 '4'를 "k"·"Li"·"너"로만 읽고 좁은 '1'은 따로 떼면 못 읽어서, 이 둘은 모양으로 알아본다(ocr.rs의 read_digits_per_glyph).

/// 숫자 칸의 글자 덩어리 열 범위들 [x0, x1) (왼쪽부터, 잉크 = 128 미만)
pub fn glyph_columns(px: &[u8], w: usize, h: usize) -> Vec<(usize, usize)> {
    let ink: Vec<bool> = (0..w).map(|x| (0..h).any(|y| px[(y * w + x) * 4] < 128)).collect();
    let mut out = vec![];
    let mut x = 0;
    while x < w {
        if ink[x] {
            let s = x;
            while x < w && ink[x] {
                x += 1;
            }
            out.push((s, x));
        } else {
            x += 1;
        }
    }
    out
}

/// 위가 두 갈래로 열린 "4"인지(림버스 광기 글꼴). 윈도우 글자 인식이 이 4를 "k"·"Li"·"너"로만 읽어서(PC 실기 2026-11-27)
/// 모양으로 알아본다(실제 모양: 왼쪽 획이 오른쪽보다 위에서 시작하고 가운데 가로 막대로 이어진 뒤 오른쪽 기둥만 내려감):
/// ① 위쪽 절반 어딘가에 떨어진 두 갈래가 있는 줄, ② 아래 25% 줄은 가운데보다 왼쪽에 잉크 없음,
/// ③ 맨 위 10% 줄에 가운데를 가로지르는 막대 없음(위가 막힌 9·7과 구별).
pub fn is_open_four(px: &[u8], w: usize, h: usize, x0: usize, x1: usize) -> bool {
    let at = |x: usize, y: usize| px[(y * w + x) * 4] < 128;
    let rows: Vec<usize> = (0..h).filter(|&y| (x0..x1).any(|x| at(x, y))).collect();
    let (Some(&top), Some(&bot)) = (rows.first(), rows.last()) else { return false };
    let gh = bot - top + 1;
    if gh < 8 || x1 - x0 < 4 {
        return false;
    }
    let runs = |y: usize| {
        let mut n = 0;
        let mut prev = false;
        for x in x0..x1 {
            let b = at(x, y);
            if b && !prev {
                n += 1;
            }
            prev = b;
        }
        n
    };
    let mid = x0 + (x1 - x0) / 2;
    let two_prongs = (top..top + gh / 2).any(|y| runs(y) == 2);
    let bottom_right = (bot + 1 - (gh / 4).max(1)..=bot).all(|y| (x0..mid).all(|x| !at(x, y)));
    let open_top = (top..top + (gh / 10).max(1)).all(|y| !(at(mid, y) && at(mid.saturating_sub(1).max(x0), y)));
    two_prongs && bottom_right && open_top
}

/// 폭이 높이의 0.4배 미만인 덩어리("1"). 림버스 광기 글꼴 실측(2026-11-27): 1은 0.29배, 5·8·4는 0.47배쯤
/// (절반으로 잡았더니 5·8까지 1로 봤다).
pub fn is_narrow_one(px: &[u8], w: usize, h: usize, x0: usize, x1: usize) -> bool {
    let rows: Vec<usize> = (0..h).filter(|&y| (x0..x1).any(|x| px[(y * w + x) * 4] < 128)).collect();
    let (Some(&top), Some(&bot)) = (rows.first(), rows.last()) else { return false };
    let gh = bot - top + 1;
    gh >= 8 && (x1 - x0) * 5 < gh * 2
}

/// 빗금 친 0("Ø", 명일방주 재화 글꼴)인지. 윈도우 글자 인식이 이 0을 "2"로 읽었다(PC 실기 2026-11-27: 171020 → "171022").
/// 가운데(높이 30~70%) 줄의 60% 이상이 왼쪽 벽·빗금·오른쪽 벽 세 갈래이고, 첫 갈래가 왼쪽 1/4에서, 끝 갈래가 오른쪽 1/4에서 끝난다.
/// 8은 가운데가 한 줄로 막혀 있고 6·9는 두 갈래라 걸리지 않는다.
pub fn is_slashed_zero(px: &[u8], w: usize, h: usize, x0: usize, x1: usize) -> bool {
    let at = |x: usize, y: usize| px[(y * w + x) * 4] < 128;
    let rows: Vec<usize> = (0..h).filter(|&y| (x0..x1).any(|x| at(x, y))).collect();
    let (Some(&top), Some(&bot)) = (rows.first(), rows.last()) else { return false };
    let gh = bot - top + 1;
    let gw = x1 - x0;
    if gh < 10 || gw < 6 {
        return false;
    }
    let band: Vec<usize> = (top + gh * 3 / 10..top + gh * 7 / 10).collect();
    let hits = band
        .iter()
        .filter(|&&y| {
            let mut spans = vec![];
            let mut x = x0;
            while x < x1 {
                if at(x, y) {
                    let s = x;
                    while x < x1 && at(x, y) {
                        x += 1;
                    }
                    spans.push((s, x));
                } else {
                    x += 1;
                }
            }
            spans.len() == 3 && spans[0].0 < x0 + gw / 4 && spans[2].1 > x1 - gw / 4
        })
        .count();
    hits * 10 >= band.len() * 6
}

/// 고른 덩어리들(열 범위)만 왼쪽부터 붙여 놓고, 그 묶음을 `times`번 이어 붙인 그림. 덩어리 사이는 `gap`, 묶음 사이는 `group_gap` 열.
/// 윈도우 글자 인식은 숫자가 한두 개뿐인 그림은 아예 못 읽어서(PC 실기 2026-11-27) 세 번 이어 붙여 읽는다.
pub fn compose(px: &[u8], w: usize, h: usize, cols: &[(usize, usize)], times: usize, gap: usize, group_gap: usize) -> (Vec<u8>, usize, usize) {
    let group: usize = cols.iter().map(|(a, b)| b - a).sum::<usize>() + gap * cols.len().saturating_sub(1);
    let margin = h / 2;
    let nw = margin * 2 + group * times + group_gap * times.saturating_sub(1);
    let mut out = vec![255u8; nw * h * 4];
    let mut x = margin;
    for t in 0..times {
        for (i, &(a, b)) in cols.iter().enumerate() {
            for y in 0..h {
                out[(y * nw + x) * 4..(y * nw + x + (b - a)) * 4].copy_from_slice(&px[(y * w + a) * 4..(y * w + b) * 4]);
            }
            x += b - a;
            if i + 1 < cols.len() {
                x += gap;
            }
        }
        if t + 1 < times {
            x += group_gap;
        }
    }
    (out, nw, h)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// '#' = 잉크인 작은 그림(줄마다 같은 폭)
    fn pic(rows: &[&str]) -> (Vec<u8>, usize, usize) {
        let (w, h) = (rows[0].len(), rows.len());
        let mut px = vec![255u8; w * h * 4];
        for (y, r) in rows.iter().enumerate() {
            for (x, c) in r.chars().enumerate() {
                if c == '#' {
                    px[(y * w + x) * 4..(y * w + x) * 4 + 3].copy_from_slice(&[0, 0, 0]);
                }
            }
        }
        (px, w, h)
    }

    #[test]
    fn limbus_four_and_one_shapes() {
        // 림버스 광기 "4"(실제 모양을 줄인 것): 왼쪽 획이 먼저 시작, 가운데 막대, 오른쪽 기둥만 내려감
        let four = ["###.....", "###.....", "###..###", "###..###", "###..###", "########", "########", ".....###", ".....###", ".....###"];
        let (p, w, h) = pic(&four);
        assert!(is_open_four(&p, w, h, 0, w));
        assert!(!is_narrow_one(&p, w, h, 0, w));
        // 위가 막힌 9는 4가 아님
        let nine = ["########", "###..###", "###..###", "###..###", "########", "########", ".....###", ".....###", ".....###", ".....###"];
        let (p, w, h) = pic(&nine);
        assert!(!is_open_four(&p, w, h, 0, w));
        // 0도 4가 아님(아래가 막힘)
        let zero = ["########", "###..###", "###..###", "###..###", "###..###", "###..###", "###..###", "###..###", "###..###", "########"];
        let (p, w, h) = pic(&zero);
        assert!(!is_open_four(&p, w, h, 0, w));
        // 1: 폭 3 / 높이 10 → 좁음. 폭 5 / 높이 10(5·8 정도)은 1이 아님
        let (p, w, h) = pic(&["###"; 10]);
        assert!(is_narrow_one(&p, w, h, 0, w));
        let (p, w, h) = pic(&["#####"; 10]);
        assert!(!is_narrow_one(&p, w, h, 0, w));
    }

    #[test]
    fn arknights_slashed_zero() {
        // 빗금 친 0: 가운데 줄이 왼쪽 벽·빗금·오른쪽 벽 세 갈래
        let zero = ["##########", "##......##", "##.....###", "##....#.##", "##...#..##", "##..#...##", "##.#....##", "###.....##", "##......##", "##########"];
        let (p, w, h) = pic(&zero);
        assert!(is_slashed_zero(&p, w, h, 0, w));
        // 8: 가운데가 막힘
        let eight = ["##########", "##......##", "##......##", "##......##", "##########", "##########", "##......##", "##......##", "##......##", "##########"];
        let (p, w, h) = pic(&eight);
        assert!(!is_slashed_zero(&p, w, h, 0, w));
        // 빗금 없는 0도 아님(두 갈래)
        let plain = ["##########", "##......##", "##......##", "##......##", "##......##", "##......##", "##......##", "##......##", "##......##", "##########"];
        let (p, w, h) = pic(&plain);
        assert!(!is_slashed_zero(&p, w, h, 0, w));
    }

}
