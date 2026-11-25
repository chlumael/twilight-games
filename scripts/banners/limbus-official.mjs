// 림버스 컴퍼니: 스팀 공식 공지(한국어)의 "특정 추출" 공지에서 배너를 읽는다.
// 공지 본문은 그림·영상뿐이라, 본문에 붙은 공식 유튜브 영상의 제목에서 픽업 이름을 읽는다.
//   공지 제목  "2026.11.26 (KST) 신규 인격 특정 추출"            → 시작 날짜
//   영상 제목  "LimbusCompany [000] A 그레고르 / [000] B 이상"   → 픽업 인격·E.G.O
// 발푸르기스의 밤처럼 영상 없이 그림만 있는 공지는 읽지 못한다(화면 인식·수동 입력 몫).

const EVENTS = "https://store.steampowered.com/events/ajaxgetpartnereventspageable/?clan_accountid=0&appid=1973530&l=koreana";
const OEMBED = "https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=";
const KEEP_DAYS = 730;

/** 공지 한 건 → { date: "2026-11-26", video } 또는 null */
export function parseEvent(event) {
  const m = String(event.event_name ?? "").match(/^\s*(\d{4})\.(\d{2})\.(\d{2}) \(KST\).*특정 추출/);
  const video = String(event.announcement_body?.body ?? "").match(/\[previewyoutube=([\w-]{6,20})/);
  if (!m || !video) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, video: video[1] };
}

/**
 * 영상 제목 → 픽업 목록. 등급 표시가 붙은 항목만 읽는다.
 * [000]=3성 인격(최고 등급), [00]=2성 인격, [ZAYIN]~[ALEPH]=E.G.O
 */
export function parseVideoTitle(title) {
  const items = [];
  for (const part of String(title).replace(/^\s*LimbusCompany\s*/i, "").split(" / ")) {
    const m = part.match(/^\s*\[(000|00|ZAYIN|TETH|HE|WAW|ALEPH)\]\s*(.+?)\s*$/);
    if (!m) continue;
    const name = m[2]
      .replace(/^-\s*신규 E\.G\.O 특정 추출\s*/, "")
      .replace(/\s*\(보이스 없음\)\s*$/, "")
      .replace(/::\s+/g, "::")
      .replace(/\s+/g, " ");
    items.push({ grade: m[1], name });
  }
  return items;
}

/** 같은 날짜의 공지를 한 배너로 묶고 기간을 채운다. */
export function buildBanners(entries) {
  const byDate = new Map();
  for (const e of entries) {
    const items = byDate.get(e.date) ?? [];
    for (const it of e.items) if (!items.some((x) => x.name === it.name)) items.push(it);
    byDate.set(e.date, items);
  }
  const dates = [...byDate.keys()].filter((d) => byDate.get(d).length).sort();
  return dates.map((date, i) => {
    const items = byDate.get(date);
    const top = items.filter((x) => x.grade !== "00");
    const item = (x) => ({ id: `ko:${x.name}`, ko: x.name, grade: x.grade });
    const next = dates[i + 1];
    return {
      id: `limbus:official:${date}`,
      group: "limbus-extraction",
      name: `${top.map((x) => x.name).join(" · ")} 특정 추출`,
      // 공지에는 날짜만 있다. 점검 종료 시각을 몰라 그날 0시(KST)로 두고 근사값으로 표시한다.
      start: new Date(`${date}T00:00:00+09:00`).toISOString(),
      startApprox: true,
      // 종료일은 공지 글에 없어 다음 특정 추출 시작으로 둔다(근사값). 마지막 배너는 미정.
      end: next ? new Date(`${next}T00:00:00+09:00`).toISOString() : null,
      ...(next ? { endApprox: true } : {}),
      version: null,
      source: "림버스 스팀 공식 공지",
      featured: top.map(item),
      featuredRare: items.filter((x) => x.grade === "00").map(item),
    };
  });
}

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": "twilight-games-banner-pack" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

export async function limbusOfficial() {
  const cutoff = Date.now() / 1000 - KEEP_DAYS * 86400;
  const events = [];
  for (let offset = 0; offset < 2000; ) {
    const page = (await get(`${EVENTS}&offset=${offset}&count=100`)).events ?? [];
    if (!page.length) break;
    events.push(...page);
    offset += page.length;
    if (page.at(-1).rtime32_start_time < cutoff) break;
  }
  const entries = [];
  for (const ev of events.filter((e) => e.rtime32_start_time >= cutoff)) {
    const p = parseEvent(ev);
    if (!p) continue;
    try {
      entries.push({ date: p.date, items: parseVideoTitle((await get(OEMBED + p.video)).title) });
    } catch (e) {
      console.warn(`림버스: ${p.date} 영상 제목을 읽지 못함 (${e.message})`);
    }
  }
  return buildBanners(entries);
}
