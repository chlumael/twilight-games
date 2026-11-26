//! 원신 기원 기록 불러오기 (DESIGN.md §4.9, 사용자 허용 2026-11-26).
//! 게임 로그에서 설치 폴더를 찾고, 웹 캐시(data_2)에서 기원 기록 주소의 인증 값(authkey)을 꺼내
//! 원신 공식 기원 기록 서버에서 캐릭터·무기·집록 기원 기록을 받는다.
//! 인증 값은 이 파일 밖으로 나가지 않는다: 저장·기록·화면 전달을 하지 않고, 아래 고정 주소 외에는 보내지 않는다.
use serde::Serialize;
use std::collections::HashMap;

/// 공식 기원 기록 서버 (genshin.py의 GACHA_URL 해외 서버 값, 2026-11-26 확인)
#[allow(dead_code)]
const API: &str = "https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog";
/// 받을 기원 종류: 캐릭터(301, 400 포함) · 무기(302) · 집록(500). 상시·초보자는 추적하지 않는다.
#[allow(dead_code)]
const TYPES: [&str; 3] = ["301", "302", "500"];

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct WishItem {
    pub id: String,
    pub gacha_type: String,
    pub name: String,
    pub item_type: String,
    pub rank_type: String,
    pub time: String,
}

#[derive(Serialize)]
pub struct WishFetch {
    tz: i32,
    items: Vec<WishItem>,
    latest: HashMap<String, String>,
}

/// 로그 내용에서 게임 데이터 폴더(…/GenshinImpact_Data 또는 …/YuanShen_Data) 경로를 찾는다 (마지막 것)
pub fn data_dir_from_log(log: &str) -> Option<String> {
    let mut found: Option<String> = None;
    for name in ["GenshinImpact_Data", "YuanShen_Data"] {
        let mut from = 0;
        while let Some(i) = log[from..].find(name) {
            let end = from + i + name.len();
            // 같은 줄에서 "X:/" 로 시작하는 곳까지 거슬러 간다
            let line_start = log[..end].rfind(['\n', '\r']).map(|p| p + 1).unwrap_or(0);
            let seg = &log[line_start..end];
            if let Some(d) = seg.char_indices().rev().find(|&(j, _)| {
                let b = seg.as_bytes();
                j + 2 < b.len() && b[j].is_ascii_alphabetic() && b[j + 1] == b':' && (b[j + 2] == b'/' || b[j + 2] == b'\\')
            }) {
                found = Some(seg[d.0..].to_string());
            }
            from = end;
        }
    }
    found
}

/// 버전 폴더 이름("2.36.0.0") 비교용
pub fn version_key(name: &str) -> Vec<u32> {
    name.split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

/// 캐시 내용에서 마지막 기원 기록 주소의 authkey 값(퍼센트 인코딩된 그대로)
pub fn authkey_from_cache(data: &str) -> Option<String> {
    let mut last = None;
    let mut from = 0;
    while let Some(i) = data[from..].find("authkey=") {
        let start = from + i + "authkey=".len();
        // 주소 안에 있는 것만: 앞쪽 같은 덩어리에 https:// 와 기원(gacha) 표시가 있어야
        let head_start = data[..start].rfind(|c: char| c.is_whitespace() || c == '\0').map(|p| p + 1).unwrap_or(0);
        let head = &data[head_start..start];
        let end = data[start..].find(|c: char| c == '&' || c == '#' || c == '\0' || c.is_whitespace()).map(|p| start + p).unwrap_or(data.len());
        if head.contains("https://") && head.contains("gacha") && end > start {
            last = Some(data[start..end].to_string());
        }
        from = end.max(start);
    }
    last
}

/// 퍼센트 인코딩 풀기
pub fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 주소에 넣을 수 있게 인코딩 (영문·숫자·-_.~ 외는 %XX)
pub fn percent_encode(s: &str) -> String {
    s.bytes()
        .map(|c| if c.is_ascii_alphanumeric() || b"-_.~".contains(&c) { (c as char).to_string() } else { format!("%{c:02X}") })
        .collect()
}

/// 서버 지역 → 시간대(UTC 기준). genshin.py: 미국 UTC-5, 유럽 UTC+1, 그 밖 UTC+8
pub fn tz_of(region: &str) -> i32 {
    match region {
        "os_usa" => -5,
        "os_euro" => 1,
        _ => 8,
    }
}

#[allow(dead_code)]
fn page_url(authkey: &str, gacha_type: &str, end_id: &str) -> String {
    format!(
        "{API}?authkey_ver=1&sign_type=2&auth_appid=webview_gacha&lang=ko-kr&game_biz=hk4e_global&authkey={}&gacha_type={gacha_type}&real_gacha_type={gacha_type}&size=20&end_id={end_id}",
        percent_encode(&percent_decode(authkey))
    )
}

/// 서버 응답 한 쪽 해석 → (기록 줄들, 지역). 오류면 사람이 읽을 이유
pub fn parse_page(body: &str) -> Result<(Vec<WishItem>, String), String> {
    let v: serde_json::Value = serde_json::from_str(body).map_err(|_| "기원 기록 서버 응답을 읽지 못했습니다".to_string())?;
    let code = v["retcode"].as_i64().unwrap_or(-1);
    if code == -101 || code == -100 {
        return Err("기원 기록 주소가 만료됐습니다. 게임에서 기원 → 기록 화면을 한 번 연 뒤 다시 눌러 주세요.".into());
    }
    if code == -110 {
        return Err("too-frequent".into());
    }
    if code != 0 {
        return Err(format!("기원 기록 서버 오류: {}", v["message"].as_str().unwrap_or("알 수 없음")));
    }
    let region = v["data"]["region"].as_str().unwrap_or("").to_string();
    let s = |x: &serde_json::Value, k: &str| x[k].as_str().unwrap_or("").to_string();
    let items = v["data"]["list"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|x| WishItem {
                    id: s(x, "id"),
                    gacha_type: s(x, "gacha_type"),
                    name: s(x, "name"),
                    item_type: s(x, "item_type"),
                    rank_type: s(x, "rank_type"),
                    time: s(x, "time"),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok((items, region))
}

/// 기원 기록 받기. stop_ids = 기원 종류별로 지난번에 받은 가장 최근 번호(그 번호를 만나면 멈춘다)
#[tauri::command(async)]
pub fn genshin_wishes(stop_ids: HashMap<String, String>) -> Result<WishFetch, String> {
    imp::fetch(&stop_ids)
}

#[cfg(not(windows))]
mod imp {
    use super::WishFetch;
    use std::collections::HashMap;
    pub fn fetch(_stop: &HashMap<String, String>) -> Result<WishFetch, String> {
        Err("원신 기원 기록 불러오기는 윈도우 PC에서만 됩니다".into())
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::path::{Path, PathBuf};
    use windows::core::HSTRING;
    use windows::Foundation::Uri;
    use windows::Web::Http::HttpClient;

    fn find_log() -> Option<PathBuf> {
        let home = std::env::var_os("USERPROFILE")?;
        let locallow = Path::new(&home).join("AppData").join("LocalLow");
        for company in ["miHoYo", "HoYoverse", "Cognosphere"] {
            for game in ["Genshin Impact", "原神"] {
                for file in ["output_log.txt", "Player.log"] {
                    let p = locallow.join(company).join(game).join(file);
                    if p.is_file() {
                        return Some(p);
                    }
                }
            }
        }
        None
    }

    fn find_cache(data_dir: &str) -> Option<PathBuf> {
        let base = Path::new(data_dir).join("webCaches");
        let best = std::fs::read_dir(&base)
            .ok()?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.chars().next().is_some_and(|c| c.is_ascii_digit()))
            .max_by_key(|n| version_key(n))?;
        let p = base.join(best).join("Cache").join("Cache_Data").join("data_2");
        p.is_file().then_some(p)
    }

    fn get(url: &str) -> Result<String, String> {
        let client = HttpClient::new().map_err(|e| format!("인터넷 연결 준비 실패: {e}"))?;
        let uri = Uri::CreateUri(&HSTRING::from(url)).map_err(|e| format!("주소 오류: {e}"))?;
        let body = client
            .GetStringAsync(&uri)
            .and_then(|op| op.get())
            .map_err(|_| "기원 기록 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.".to_string())?;
        Ok(body.to_string())
    }

    pub fn fetch(stop: &HashMap<String, String>) -> Result<WishFetch, String> {
        let log = find_log().ok_or("원신 로그 파일을 찾지 못했습니다. 이 PC에서 원신을 한 번 실행해 주세요.")?;
        let log_text = String::from_utf8_lossy(&std::fs::read(&log).map_err(|e| format!("로그 파일을 읽지 못했습니다: {e}"))?).into_owned();
        let data_dir = data_dir_from_log(&log_text).ok_or("로그에서 원신 설치 폴더를 찾지 못했습니다. 원신을 한 번 실행해 주세요.")?;
        let cache = find_cache(&data_dir).ok_or("원신 웹 캐시를 찾지 못했습니다. 게임에서 기원 → 기록 화면을 한 번 열어 주세요.")?;
        let cache_text = String::from_utf8_lossy(&std::fs::read(&cache).map_err(|e| format!("캐시를 읽지 못했습니다: {e}"))?).into_owned();
        let authkey = authkey_from_cache(&cache_text).ok_or("기원 기록 주소를 찾지 못했습니다. 게임에서 기원 → 기록 화면을 한 번 열어 주세요.")?;

        let mut items = Vec::new();
        let mut latest = HashMap::new();
        let mut region = String::new();
        for t in TYPES {
            let mut end_id = "0".to_string();
            'pages: for _ in 0..500 {
                let mut tries = 0;
                let (page, reg) = loop {
                    match parse_page(&get(&page_url(&authkey, t, &end_id))?) {
                        Err(e) if e == "too-frequent" && tries < 3 => {
                            tries += 1;
                            std::thread::sleep(std::time::Duration::from_millis(1500));
                        }
                        Err(e) if e == "too-frequent" => return Err("기원 기록 서버가 요청이 너무 잦다고 합니다. 잠시 뒤 다시 눌러 주세요.".into()),
                        other => break other?,
                    }
                };
                if !reg.is_empty() {
                    region = reg;
                }
                if page.is_empty() {
                    break;
                }
                if end_id == "0" {
                    latest.insert(t.to_string(), page[0].id.clone());
                }
                for it in &page {
                    if stop.get(t) == Some(&it.id) {
                        break 'pages;
                    }
                    items.push(it.clone());
                }
                end_id = page.last().map(|x| x.id.clone()).unwrap_or_default();
                std::thread::sleep(std::time::Duration::from_millis(350));
            }
        }
        Ok(WishFetch { tz: tz_of(&region), items, latest })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_data_dir_and_authkey() {
        let log = "Warmup file C:/Program Files/HoYoPlay/games/Genshin Impact game/GenshinImpact_Data/StreamingAssets/x\n";
        assert_eq!(data_dir_from_log(log).as_deref(), Some("C:/Program Files/HoYoPlay/games/Genshin Impact game/GenshinImpact_Data"));
        let cache = "junk\0https://webstatic.example/x?a=1\0https://gs.hoyoverse.com/genshin/event/e20190909gacha-v3/index.html?win_mode=fullscreen&authkey=AB%2Bc%3D&lang=ko\0more authkey=nope";
        assert_eq!(authkey_from_cache(cache).as_deref(), Some("AB%2Bc%3D"));
        assert_eq!(percent_encode(&percent_decode("AB%2Bc%3D")), "AB%2Bc%3D");
        assert!(version_key("2.36.0.0") > version_key("2.9.0.0"));
    }

    #[test]
    fn parses_page() {
        let body = r#"{"retcode":0,"message":"OK","data":{"page":"1","size":"20","region":"os_asia","list":[{"uid":"8","gacha_type":"400","item_id":"","count":"1","time":"2026-11-20 12:00:05","name":"푸리나","lang":"ko-kr","item_type":"캐릭터","rank_type":"5","id":"1700000000000000001"}]}}"#;
        let (items, region) = parse_page(body).unwrap();
        assert_eq!(region, "os_asia");
        assert_eq!(items[0].name, "푸리나");
        assert_eq!(tz_of(&region), 8);
        assert!(parse_page(r#"{"retcode":-101,"message":"authkey timeout","data":null}"#).unwrap_err().contains("만료"));
    }
}
