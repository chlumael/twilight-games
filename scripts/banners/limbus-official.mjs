// 림버스 컴퍼니: 스팀 공식 공지(한국어)의 "특정 추출" 공지에서 배너를 읽는다.
// 공지 본문은 그림·영상뿐이라, 본문에 붙은 공식 유튜브 영상의 제목에서 픽업 이름을 읽는다.
//   공지 제목  "2026.11.26 (KST) 신규 인격 특정 추출"            → 시작 날짜
//   정기 업데이트 공지(그림) 2쪽의 "(11/26 12:00 ~ 12/10 10:00 (KST))" → 정확한 기간 (글자 인식)
//   영상 제목  "LimbusCompany [000] A 그레고르 / [000] B 이상"   → 픽업 인격·E.G.O
// 발푸르기스의 밤 공지는 영상이 없다. 배너와 기간은 공지에서 읽고, 그림 안에만 있는 픽업 이름은
// data/names/limbus-walpurgis.json 에 따로 적는다(공지 그림을 보고 옮겨 적은 것).

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

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

/** "2026년 11월 26일 정기 업데이트 안내" → "2026-11-26" 또는 null */
export function parseUpdateTitle(name) {
  const m = String(name ?? "").match(/^\s*(\d{4})년 (\d{1,2})월 (\d{1,2})일 정기 업데이트 안내/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
}

/**
 * 정기 업데이트 공지 그림을 글자 인식한 글에서 "신규 … 특정 추출"의 기간을 읽는다.
 *   "1. 신규 인격 특정 추출 [이름] (11/26 12:00 ~ 12/10 10:00 (KST))"
 * 숫자만 쓰므로 이름이 잘못 인식돼도 영향이 없다. 연도는 업데이트 날짜에서 가져온다.
 * 시작 날짜가 업데이트 날짜와 다르면(잘못 읽음) null.
 */
export function parseNewExtractionPeriod(text, date) {
  const lines = String(text).split("\n");
  const at = lines.findIndex((l) => /^\s*\d+\s*[.,]\s*신규.*특정\s*추출/.test(l));
  if (at < 0) return null;
  const m = lines.slice(at, at + 3).join(" ")
    .match(/(\d{1,2})\s*\/\s*(\d{1,2}?)\s*(\d{2})\s*:\s*(\d{2})\s*~\s*(\d{1,2})\s*\/\s*(\d{1,2}?)\s*(\d{2})\s*:\s*(\d{2})/);
  if (!m) return null;
  const [y, mo, d] = date.split("-").map(Number);
  const [m1, d1, h1, n1, m2, d2, h2, n2] = m.slice(1).map(Number);
  if (m1 !== mo || d1 !== d) return null;
  const iso = (yy, mm, dd, hh, nn) => {
    const p = (x) => String(x).padStart(2, "0");
    const t = new Date(`${yy}-${p(mm)}-${p(dd)}T${p(hh)}:${p(nn)}:00+09:00`);
    return Number.isNaN(t.getTime()) ? null : t.toISOString();
  };
  const start = iso(y, m1, d1, h1, n1);
  const end = iso(m2 < m1 ? y + 1 : y, m2, d2, h2, n2);
  return start && end && end > start ? { start, end } : null;
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
 * periods: { "2026-11-26": { start, end } } 정기 업데이트 공지에서 읽은 정확한 기간
 */
export function buildBanners(entries, walpurgis = [], names = {}, periods = {}) {
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
      date, start: periods[date]?.start ?? null, end: periods[date]?.end ?? null, items,
    });
  }
  const rounds = new Map();
  for (const w of walpurgis) if (!rounds.has(w.round) || w.start) rounds.set(w.round, w);
  for (const w of rounds.values()) {
    list.push({
      id: `limbus:official:walpurgis-${w.round}`,
      name: `제${w.round}회 발푸르기스의 밤 특정 추출`,
      date: w.date, start: w.start ?? periods[w.date]?.start ?? null, end: w.end ?? periods[w.date]?.end ?? null,
      items: names[w.round] ?? [],
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

const run = promisify(execFile);
const IMAGE = "https://clan.akamai.steamstatic.com/images";

/** 공지 그림 한 장을 글자 인식한다. tesseract가 없으면 예외. */
async function ocr(url, dir) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const file = join(dir, "page.png");
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return (await run("tesseract", [file, "-", "-l", "kor+eng", "--psm", "6"], { maxBuffer: 1 << 22 })).stdout;
}

/**
 * 정확한 기간이 아직 없는 날짜만 정기 업데이트 공지(그림)를 글자 인식해서 채운다.
 * known: 이전 팩에서 이어받은 { 날짜: { start, end } }. tesseract가 없으면 이어받은 것만 쓴다.
 */
async function readPeriods(events, dates, known) {
  const periods = { ...known };
  const todo = events.filter((e) => {
    const d = parseUpdateTitle(e.event_name);
    return d && dates.has(d) && !periods[d];
  });
  if (!todo.length) return periods;
  const dir = await mkdtemp(join(tmpdir(), "limbus-"));
  try {
    for (const ev of todo) {
      const date = parseUpdateTitle(ev.event_name);
      const pages = [...String(ev.announcement_body?.body ?? "").matchAll(/\[img\]\{STEAM_CLAN_IMAGE\}([^\[]+)\[\/img\]/g)];
      for (const page of pages.slice(1, 4)) { // 추출 안내는 보통 2쪽에 있다
        const period = parseNewExtractionPeriod(await ocr(IMAGE + page[1], dir), date);
        if (period) { periods[date] = period; break; }
      }
    }
  } catch (e) {
    console.warn(`림버스: 정기 업데이트 공지의 기간을 읽지 못함 → 근사값 사용 (${e.code === "ENOENT" ? "tesseract 없음" : e.message})`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return periods;
}

/** 이전 팩에서 정확한 기간(근사 표시가 없는 것)을 날짜별로 이어받는다. */
export function knownPeriods(previous) {
  const out = {};
  for (const b of previous ?? []) {
    const d = b.id?.match(/^limbus:official:(\d{4}-\d{2}-\d{2})$/)?.[1];
    if (d && b.start && b.end && !b.startApprox && !b.endApprox) out[d] = { start: b.start, end: b.end };
  }
  return out;
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
  const previous = await readFile(new URL("../../data/banners.json", import.meta.url), "utf8")
    .then((t) => JSON.parse(t).games?.limbus ?? []).catch(() => []);
  const dates = new Set([...entries.map((e) => e.date), ...walpurgis.filter((w) => !w.start).map((w) => w.date)]);
  const periods = await readPeriods(events, dates, knownPeriods(previous));
  const images = eventImages(events);
  return buildBanners(entries, walpurgis, names, periods).map((b) => (images[b.id] ? { ...b, image: images[b.id] } : b));
}

/** 2025년 12월 전 공지가 모두 쓰던 공통 표지(게임 로고) — 배너 그림이 아니다 */
const GENERIC_CAPSULE = "62e63adbc551470064256668df2ba6cae5138cad.png";
const CLAN0 = 103582791429521408n;

/**
 * 배너 그림: 공지마다 그 배너의 표지(capsule)가 있으면 그것을, 없으면 공지 속 소개 영상의 미리보기 그림을 쓴다.
 * 같은 배너의 공지가 여럿이면 가장 이른 것. 앱은 줄인 사본(data/images)을 쓴다 — scripts/images
 */
export function eventImages(events) {
  const out = {};
  for (const e of [...events].sort((a, b) => a.rtime32_start_time - b.rtime32_start_time)) {
    const n = String(e.event_name ?? "");
    const w = n.match(/^\s*\d{4}\.\d{2}\.\d{2} \(KST\) 제(\d+)회 발푸르기스의 밤/);
    const m = n.match(/^\s*(\d{4})\.(\d{2})\.(\d{2}) \(KST\).*특정 추출/);
    const key = w ? `limbus:official:walpurgis-${w[1]}` : m ? `limbus:official:${m[1]}-${m[2]}-${m[3]}` : null;
    if (!key || out[key]) continue;
    let json = {};
    try { json = typeof e.jsondata === "string" ? JSON.parse(e.jsondata) : e.jsondata ?? {}; } catch { /* 깨진 칸 */ }
    const cap = json.localized_capsule_image?.[0];
    const yt = String(e.announcement_body?.body ?? "").match(/\[previewyoutube=([\w-]{6,20})/);
    if (cap && cap !== GENERIC_CAPSULE && /^[\w.]+$/.test(cap) && e.clan_steamid) {
      out[key] = `https://clan.akamai.steamstatic.com/images/${BigInt(e.clan_steamid) - CLAN0}/${cap}`;
    } else if (yt) out[key] = `https://i.ytimg.com/vi/${yt[1]}/maxresdefault.jpg`;
  }
  return out;
}
