//! 칸 읽기 시험 도구 (윈도우 전용, 배포 파일에는 들어가지 않는다 — cargo의 examples).
//! 스크린샷 PNG 한 장을 앱과 똑같이 처리한다: 화면 판단(regions.rs) → 칸 자르기(crop) → 흰 바탕(to_ink) → 윈도우 글자 인식(ocr.rs).
//! 앱이 쓰는 regions.rs·ink.rs·ocr.rs 파일을 그대로 가져다 쓴다(따로 고친 사본 없음).
//!
//! 쓰는 법 (src-tauri 폴더에서):
//!   cargo run --example region_test -- <스크린샷.png> [--out <폴더>] [--all]
//!   --out : 칸마다 글자 인식에 넘긴 그림(흰 바탕으로 바꾼 것)을 PNG로 저장(눈으로 확인용, 저장소 밖에 둘 것)
//!   --all : 화면 판단이 안 맞아도 모든 화면의 칸을 읽어 본다
//!   --rect x,y,w,h : data와 상관없이 이 위치(비율)만 읽어 본다(위치 조정용, 숫자 칸이면 --digits)
//!   --sweep : 칸마다 배율(1~8)·언어(한국어·일본어)·글자 사이 벌리기를 바꿔 가며 읽어 본다
#[path = "../src/regions.rs"]
#[allow(dead_code)]
mod regions;
#[path = "../src/ink.rs"]
#[allow(dead_code)]
mod ink;
#[path = "../src/ocr.rs"]
#[allow(dead_code)]
mod ocr;

use ink::scale_for;
use regions::{content_rect, feature, hamming, match_screen, rect_px, FieldDef, Image, Profile};
use std::path::{Path, PathBuf};

/// 스크린샷(PNG·WebP·JPEG, 확장자가 아니라 내용으로 판단) → 앱이 찍는 그림과 같은 BGRA
fn load_png(path: &Path) -> (Vec<u8>, usize, usize) {
    let img = image::ImageReader::open(path)
        .and_then(|r| r.with_guessed_format())
        .unwrap_or_else(|e| panic!("그림을 열 수 없음 {}: {e}", path.display()))
        .decode()
        .unwrap_or_else(|e| panic!("그림 읽기 {}: {e}", path.display()))
        .to_rgba8();
    let (w, h) = (img.width() as usize, img.height() as usize);
    let mut out = img.into_raw();
    for p in out.chunks_mut(4) {
        p.swap(0, 2);
        p[3] = 255;
    }
    (out, w, h)
}

fn save_png(path: &Path, bgra: &[u8], w: usize, h: usize) {
    let mut rgb = Vec::with_capacity(w * h * 3);
    for p in bgra.chunks(4) {
        rgb.extend_from_slice(&[p[2], p[1], p[0]]);
    }
    image::RgbImage::from_raw(w as u32, h as u32, rgb).expect("그림 크기").save(path).expect("그림 저장");
}

fn load_profiles() -> Vec<Profile> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/screens");
    let mut out = vec![];
    let mut files: Vec<_> = std::fs::read_dir(&dir).expect("data/screens 폴더").flatten().map(|e| e.path()).collect();
    files.sort();
    for p in files {
        if p.extension().and_then(|e| e.to_str()) == Some("json") {
            let text = std::fs::read_to_string(&p).expect("틀 파일 읽기");
            out.push(serde_json::from_str::<Profile>(&text).unwrap_or_else(|e| panic!("{}: {e}", p.display())));
        }
    }
    out
}

/// 칸 하나: 앱과 같은 read_def로 읽고, --out이면 글자 인식에 넘긴 그림(자르기·흰 바탕까지)도 저장
fn read_one(img: &Image, area: (usize, usize, usize, usize), out: Option<&PathBuf>, name: &str, f: &FieldDef) -> String {
    if let Some(dir) = out {
        let (px, cw, ch) = ocr::prepare_field(img, area, scale_for(area), f.kind == "digits");
        save_png(&dir.join(format!("{name}.png")), &px, cw, ch);
    }
    ocr::read_def(img, area, f)
}

/// 실기 오독 바꿈 표(data의 fixes) — 앱(screen-profile.ts applyFixes)과 같은 순서로 적용해 보여 주기만 한다
fn load_fixes() -> std::collections::HashMap<String, Vec<(String, String)>> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/screens");
    let mut out = std::collections::HashMap::new();
    for e in std::fs::read_dir(&dir).expect("data/screens 폴더").flatten() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(e.path()).unwrap_or_default()) else { continue };
        let game = v["game"].as_str().unwrap_or_default().to_string();
        let fixes = v["fixes"].as_array().map(|a| a.iter().filter_map(|p| Some((p[0].as_str()?.to_string(), p[1].as_str()?.to_string()))).collect()).unwrap_or_default();
        out.insert(game, fixes);
    }
    out
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(shot) = args.first() else {
        eprintln!("쓰는 법: cargo run --example region_test -- <스크린샷.png> [--out <폴더>] [--all] [--sweep] [--rect x,y,w,h [--digits]]");
        std::process::exit(2);
    };
    let flag = |name: &str| args.iter().position(|a| a == name);
    let out = flag("--out").and_then(|i| args.get(i + 1)).map(PathBuf::from);
    if let Some(d) = &out {
        std::fs::create_dir_all(d).expect("--out 폴더 만들기");
    }
    let all = flag("--all").is_some();
    let sweep = flag("--sweep").is_some();
    let (mut px, w, h) = load_png(Path::new(shot));
    // --shift dx,dy : 그림을 몇 픽셀 밀어 본다(칸 위치가 조금 어긋나도 읽히는지)
    if let Some(s) = flag("--shift").and_then(|i| args.get(i + 1)) {
        let v: Vec<i64> = s.split(',').map(|s| s.trim().parse().expect("--shift 숫자")).collect();
        let src = px.clone();
        for y in 0..h as i64 {
            for x in 0..w as i64 {
                let (sx, sy) = ((x - v[0]).clamp(0, w as i64 - 1), (y - v[1]).clamp(0, h as i64 - 1));
                let (d, s) = (((y * w as i64 + x) * 4) as usize, ((sy * w as i64 + sx) * 4) as usize);
                px[d..d + 4].copy_from_slice(&src[s..s + 4]);
            }
        }
    }
    let img = Image { w, h, px: &px };
    println!("그림 {w}×{h}");

    if let Some(r) = flag("--rect").and_then(|i| args.get(i + 1)) {
        let v: Vec<f64> = r.split(',').map(|s| s.trim().parse().expect("--rect 숫자")).collect();
        let content = content_rect(w, h, Some(16.0 / 9.0));
        let area = rect_px(w, h, content, [v[0], v[1], v[2], v[3]]).expect("위치가 너무 작음");
        let def = FieldDef { id: "rect".into(), rect: None, kind: if flag("--digits").is_some() { "digits".into() } else { "text".into() }, spacing: None };
        println!("[{r}] 픽셀 {area:?} → \"{}\"", read_one(&img, area, out.as_ref(), "rect", &def));
        return;
    }

    let profiles = load_profiles();
    // 화면 판단 부분마다 거리(모양 지문 차이 / 색 차이) — 맞지 않을 때 어디가 다른지 보려고
    println!("\n== 화면 판단 ==");
    for p in &profiles {
        let content = content_rect(w, h, p.aspect);
        for s in &p.screens {
            for d in &s.detect {
                let (Some(rect), Some(hash), Some(rgb)) = (d.rect, d.hash.as_ref(), d.rgb) else { continue };
                let Some(area) = rect_px(w, h, content, rect) else { continue };
                let (fh, fc) = feature(&img, area);
                let dist = hamming(&fh, hash);
                let color: u32 = (0..3).map(|i| (fc[i] as i32 - rgb[i] as i32).unsigned_abs()).sum();
                let ok = dist <= d.max_distance.unwrap_or(10) && color <= d.max_color.unwrap_or(40);
                println!("{:<28} 지문 거리 {dist:>2}/{:<2} 색 차이 {color:>3}/{:<3} {} (지문 {fh}, 색 {fc:?})",
                    s.id, d.max_distance.unwrap_or(10), d.max_color.unwrap_or(40), if ok { "맞음" } else { "-" });
            }
        }
    }
    let matched = match_screen(&img, &profiles).map(|(_, s, _)| s.id.clone());
    println!("→ 판단된 화면: {}", matched.as_deref().unwrap_or("없음"));

    let fixes = load_fixes();
    println!("\n== 칸 읽기 ==");
    for p in &profiles {
        let content = content_rect(w, h, p.aspect);
        for s in &p.screens {
            if !(all || matched.as_deref() == Some(s.id.as_str())) {
                continue;
            }
            for f in &s.fields {
                let Some(area) = f.rect.and_then(|r| rect_px(w, h, content, r)) else { continue };
                let name = format!("{}__{}", s.id, f.id);
                let text = read_one(&img, area, out.as_ref(), &name, f);
                let mut fixed = text.clone();
                for (from, to) in fixes.get(&p.game).into_iter().flatten() {
                    fixed = fixed.replace(from.as_str(), to.as_str());
                }
                let note = if fixed != text { format!(" → 바꿈 표 적용 \"{fixed}\"") } else { String::new() };
                println!("{:<28} {:<16} \"{text}\"{note}  (높이 {}px, 배율 {})", s.id, f.id, area.3 - area.1, scale_for(area));
                if sweep {
                    // 배율·언어를 바꿔 가며 (어느 조합이 잘 읽히는지 보려고)
                    for lang in ["ko", "ja"] {
                        let Ok(eng) = ocr::engine_for(lang) else { continue };
                        let row: Vec<String> = (1..=ink::MAX_SCALE)
                            .map(|sc| {
                                let (px, cw, ch) = ocr::prepare_field(&img, area, sc, f.kind == "digits");
                                let t = ocr::ocr_with(&eng, &px, cw as i32, ch as i32).map(ocr::join_lines).unwrap_or_default();
                                format!("{sc}:\"{t}\"")
                            })
                            .collect();
                        println!("      {lang} {}", row.join(" "));
                    }
                    if f.kind == "digits" {
                        let eng = ocr::engine().expect("한국어 글자 인식");
                        for gap in [0.15, 0.25, 0.4] {
                            let row: Vec<String> = (1..=ink::MAX_SCALE)
                                .map(|sc| {
                                    let (px, cw, ch) = ocr::prepare_field(&img, area, sc, f.kind == "digits");
                                    let (px, cw, ch) = ink::space_glyphs(&px, cw, ch, gap);
                                    let t = ocr::ocr_with(&eng, &px, cw as i32, ch as i32).map(ocr::join_lines).unwrap_or_default();
                                    format!("{sc}:\"{t}\"")
                                })
                                .collect();
                            println!("      띄움{gap} {}", row.join(" "));
                        }
                    }
                }
            }
        }
    }
}
