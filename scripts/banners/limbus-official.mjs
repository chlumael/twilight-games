// 림버스 컴퍼니: 스팀 공식 공지(한국어)의 "특정 추출" 공지에서 배너를 읽는다.
// 공지 본문은 그림·영상뿐이라, 본문에 붙은 공식 유튜브 영상의 제목에서 픽업 이름을 읽는다.
//   공지 제목  "2026.11.26 (KST) 신규 인격 특정 추출"            → 시작 날짜
//   영상 제목  "LimbusCompany [000] A 그레고르 / [000] B 이상"   → 픽업 인격·E.G.O
// 발푸르기스의 밤 공지는 영상이 없다. 배너와 기간은 공지에서 읽고, 그림 안에만 있는 픽업 이름은
// data/names/limbus-walpurgis.json 에 따로 적는다(공지 그림을 보고 옮겨 적은 것).

import { readFile } from "node:fs/promises";

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
 * 발푸르기스의 밤 공지 → { round, date, start, end } 또는 null.
 * 기간은 공지에 설정된 이벤트 시간을 쓴다(하루 넘게 잡혀 있을 때만. 옛 공지는 게시 시각만 들어 있다).
 * 픽업 이름은 공지 그림 안에만 있어 자동으로 읽지 못한다 → data/names/limbus-walpurgis.json
 */
export function parseWalpurgis(event) {
  const m = String(event.event_name ?? "").match(
    /^\s*(\d{4})\.(\d{2})\.(\d{2}) \(KST\) 제(\d+)회 발푸르기스의 밤 (?:특정 추출|신규 인격 & E\.G\.O 정보 안내)/);
  if (!m) return null;
  const from = event.rtime32_start_time, to = event.rtime32_end_time;
  const timed = from && to && to - from > 86400;
  return {
    round: Number(m[4]),
    date: `${m[1]}-${m[2]}-${m[3]}`,
    start: timed ? new Date(from * 1000).toISOString() : null,
    end: timed ? new Date(to * 1000).toISOString() : null,
  };
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

const item = (x) => ({ id: `ko:${x.name}`, ko: x.name, grade: x.grade });
const SOURCE = "림버스 스팀 공식 공지";

/**
 * 같은 날짜의 공지를 한 배너로 묶고 기간을 채운다.
 * walpurgis: parseWalpurgis 결과 목록, names: { "10": [{ grade, name }] } (회차별 픽업 이름)
 */
export function buildBanners(entries, walpurgis = [], names = {}) {
  const byDate = new Map();
  for (const e of entries) {
    const items = byDate.get(e.date) ?? [];
    for (const it of e.items) if (!items.some((x) => x.name === it.name)) items.push(it);
    byDate.set(e.date, items);
  }
  const list = [];
  for (const [date, items] of byDate) {
    if (!items.length) continue;
    const top = items.filter((x) => x.grade !== "00");
    list.push({
      id: `limbus:official:${date}`,
      name: `${top.map((x) => x.name).join(" · ")} 특정 추출`,
      date, start: null, end: null, items,
    });
  }
  const rounds = new Map();
  for (const w of walpurgis) if (!rounds.has(w.round) || w.start) rounds.set(w.round, w);
  for (const w of rounds.values()) {
    list.push({
      id: `limbus:official:walpurgis-${w.round}`,
      name: `제${w.round}회 발푸르기스의 밤 특정 추출`,
      date: w.date, start: w.start, end: w.end, items: names[w.round] ?? [],
    });
  }
  // 공지에 날짜만 있으면 그날 0시(KST)로 두고 근사값으로 표시한다.
  for (const b of list) {
    b.startApprox = b.start === null;
    b.start ??= new Date(`${b.date}T00:00:00+09:00`).toISOString();
  }
  list.sort((a, b) => a.start.localeCompare(b.start));
  return list.map((b, i) => {
    // 종료일이 공지에 없으면 그 뒤 첫 배너의 시작으로 둔다(근사값). 마지막 배너는 미정.
    const next = list.slice(i + 1).find((n) => n.start > b.start);
    const end = b.end ?? next?.start ?? null;
    return {
      id: b.id,
      group: "limbus-extraction",
      name: b.name,
      start: b.start,
      ...(b.startApprox ? { startApprox: true } : {}),
      end,
      ...(b.end === null && end ? { endApprox: true } : {}),
      version: null,
      source: SOURCE,
      featured: b.items.filter((x) => x.grade !== "00").map(item),
      featuredRare: b.items.filter((x) => x.grade === "00").map(item),
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
  const walpurgis = [];
  for (const ev of events.filter((e) => e.rtime32_start_time >= cutoff)) {
    const w = parseWalpurgis(ev);
    if (w) walpurgis.push(w);
    const p = parseEvent(ev);
    if (!p) continue;
    try {
      entries.push({ date: p.date, items: parseVideoTitle((await get(OEMBED + p.video)).title) });
    } catch (e) {
      console.warn(`림버스: ${p.date} 영상 제목을 읽지 못함 (${e.message})`);
    }
  }
  const names = await readFile(new URL("../../data/names/limbus-walpurgis.json", import.meta.url), "utf8")
    .then((t) => JSON.parse(t).rounds ?? {}).catch(() => ({}));
  const missing = [...new Set(walpurgis.map((w) => w.round))].filter((r) => !names[r]?.length);
  if (missing.length) console.warn(`림버스: 발푸르기스의 밤 픽업 이름이 비어 있는 회차 → ${missing.join(", ")} (data/names/limbus-walpurgis.json)`);
  return buildBanners(entries, walpurgis, names);
}
