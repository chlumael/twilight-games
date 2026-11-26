// 달력용 일정 수집 (사용자 요청 2026-11-26): 게임 안 이벤트, 버전 시작·끝, 외부 행사(공식 소식).
// 픽업 기간은 배너 자료에 이미 있어서 여기서는 모으지 않는다(앱이 배너에서 만든다).
// 출처는 모두 공식 공지·게임 데이터이고 글·데이터로만 읽는다(실행하지 않음).
//
// 일정 한 건: { id, kind: "event" | "version" | "offline", title, start, end, startApprox?, endApprox?, source, url? }
//   end = null 이면 끝나는 날 미정. startApprox/endApprox = 공지에 정확한 시각이 없어 추정한 값.

import { plainText } from "./endfield-official.mjs";

const UA = { headers: { "User-Agent": "twilight-games-banner-pack" } };
async function getJson(url) {
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** "2026-11-19 16:00:00" 또는 "2026/11/19 16:00" (UTC+tz) → ISO */
export function zoned(s, tz = 8) {
  const m = String(s ?? "").match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "00"] = m;
  const p = (x) => String(x).padStart(2, "0");
  const sign = tz >= 0 ? "+" : "-";
  return new Date(`${y}-${p(mo)}-${p(d)}T${p(h)}:${mi}:00${sign}${p(Math.abs(tz))}:00`).toISOString();
}

// 외부 행사·소식으로 볼 제목 (오프라인 행사, 콜라보, 방송 등)
const OFFLINE = /콜라보|collaboration|오프라인|팝업|pop-?up|카페|페스티벌|콘서트|전시|EXPO|방송|라이브|offline|행사/i;

/**
 * 외부 행사 공지 글에서 행사 기간을 찾는다: "2026/12/05", "2026.12.05", "2026년 12월 5일", "12월 5일"(연도는 공지 해의 것),
 * "December 5, 2026"·"Dec 5"(영어 공지). 공지 날짜 앞뒤 1년 안의 날짜만 쓰고, 가장 이른 날 ~ 가장 늦은 날(같으면 하루).
 * 못 찾으면 null (공지 날짜 하루로 둔다).
 */
export function datesIn(text, postedIso) {
  const posted = Date.parse(postedIso);
  const year = new Date(posted).getUTCFullYear();
  const t = String(text ?? "");
  const found = [];
  const MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const add = (y, m, d) => {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return;
    const ms = Date.UTC(y, m - 1, d, 3); // 한국 정오쯤 (날짜만 쓰므로 시각은 의미 없음)
    if (Math.abs(ms - posted) <= 366 * 864e5) found.push(ms);
  };
  for (const m of t.matchAll(/(20\d{2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})/g)) add(+m[1], +m[2], +m[3]);
  for (const m of t.matchAll(/(?:(20\d{2})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) add(m[1] ? +m[1] : year, +m[2], +m[3]);
  for (const m of t.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?/gi)) {
    add(m[3] ? +m[3] : year, MONTH[m[1].toLowerCase()], +m[2]);
  }
  if (!found.length) return null;
  const a = Math.min(...found);
  const b = Math.max(...found);
  return { start: new Date(a).toISOString(), end: b > a ? new Date(b).toISOString() : null };
}

// ───────────────────────── 원신: 게임 안 공지 목록 ─────────────────────────
const GENSHIN_ANN = "https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api/getAnnList"
  + "?game=hk4e&game_biz=hk4e_global&lang=ko&bundle_id=hk4e_global&platform=pc&region=os_asia&level=55&uid=100000000";

/** 공지 목록 → 일정. 이벤트 공지(기원 제외)와 "N.N 버전 업데이트 안내"(버전 기간) */
export function genshinItems(data) {
  const tz = Number(data?.timezone ?? 8);
  const out = [];
  for (const group of data?.list ?? []) {
    for (const a of group.list ?? []) {
      const sub = (a.subtitle ?? "").trim();
      const start = zoned(a.start_time, tz);
      const end = zoned(a.end_time, tz);
      if (!start) continue;
      const ver = sub.match(/^(\d+\.\d+) 버전 업데이트 안내$/);
      if (ver) {
        const name = (a.title ?? "").match(/「([^」]+)」/)?.[1];
        out.push({ id: `genshin:version:${ver[1]}`, kind: "version", title: `${ver[1]} 버전${name ? ` 「${name}」` : ""}`, start, end, source: "원신 게임 안 공지" });
        continue;
      }
      if (group.type_id !== 1) continue; // 이벤트 공지만
      if (/기원$/.test(sub) || /기원/.test(a.title ?? "") && /확률 UP|기원 오픈/.test(a.title ?? "")) continue; // 픽업은 배너 자료에서
      if (end && Date.parse(end) - Date.parse(start) > 200 * 864e5) continue; // 반년 넘는 상시 안내는 뺀다
      out.push({ id: `genshin:ann:${a.ann_id}`, kind: OFFLINE.test(sub) ? "offline" : "event", title: sub || a.title, start, end, source: "원신 게임 안 공지" });
    }
  }
  return out;
}

// ───────────────────────── 명일방주: 한국 서버 게임 데이터 ─────────────────────────
const AK_ACTIVITY = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/kr/gamedata/excel/activity_table.json";

/** activity_table.json의 basicInfo → 이벤트 일정 (최근 400일) */
export function arknightsItems(table, now = Date.now()) {
  const out = [];
  for (const [id, a] of Object.entries(table?.basicInfo ?? {})) {
    if (!a?.startTime || !a?.endTime || !a.name) continue;
    const start = a.startTime * 1000;
    const end = a.endTime * 1000;
    if (end < now - 400 * 864e5 || end - start > 200 * 864e5) continue;
    out.push({
      id: `arknights:act:${id}`,
      kind: "event",
      title: a.name.trim(),
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      source: "명일방주 한국 서버 게임 데이터",
    });
  }
  return out;
}

// ───────────────────────── 엔드필드: 한국어 공식 공지 ─────────────────────────
const EF_API = "https://web-news.gryphline.com/api/bulletin";
const EF_QUERY = "lang=ko-kr&code=arknights_endfield_official";

/**
 * 기간 글 하나 → { start, end, startApprox?, endApprox? }.
 * "A ~ B" 꼴. 날짜 대신 "버전 업데이트 후"는 버전 시작, "버전 업데이트 (점검) 전"은 버전 끝(모르면 null), "「X」 버전 기간"은 버전 전체.
 */
export function efPeriod(text, version) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  if (/버전 기간/.test(t) && !t.includes("~")) {
    return version ? { start: version.start, end: version.end ?? null, ...(version.end ? { endApprox: true } : {}) } : null;
  }
  const [a = "", b = ""] = t.split("~");
  let start = zoned(a);
  let startApprox = false;
  if (!start && /업데이트 후|정식 출시 후/.test(a) && version) { start = version.start; startApprox = false; }
  if (!start) return null;
  let end = zoned(b);
  let endApprox = false;
  if (!end && /업데이트.*전/.test(b)) { end = version?.end ?? null; endApprox = !!end; }
  return { start, end, ...(startApprox ? { startApprox: true } : {}), ...(endApprox ? { endApprox: true } : {}) };
}

/**
 * 공지 글 → 그 안의 이벤트들. 제목 줄("3. 「X」 이벤트", "▼//「X」 …", "■ …") 아래의 "이벤트 시간:"/"개방 시간:" 줄을 읽는다.
 * 기간이 다음 줄들에 있으면(지역별로 여러 줄) 시작 날짜가 다른 것만 따로 넣는다(같은 날짜의 다른 지역 줄은 건너뜀).
 */
export function efSections(text, version, idBase) {
  const lines = String(text).split("\n");
  const out = [];
  let heading = null;
  const clean = (s) => s.replace(/^(\d+\.\s*|▼\s*\/\/\s*|■\s*)/, "").trim();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^(\d+\.\s+|▼\s*\/\/|■\s)/.test(l)) { heading = clean(l); continue; }
    const m = l.match(/(?:이벤트|개방) (?:시간|기간)\s*[:：]\s*(.*)$/);
    if (!m || !heading) continue;
    if (/헤드헌팅|신청」|신청 안내|점검|보상 지급|업데이트 시간/.test(heading)) continue;
    const periods = [];
    if (m[1]) periods.push(m[1]);
    else {
      for (const n of lines.slice(i + 1)) {
        if (/^[·※▼■]|^\d+\.\s/.test(n)) break;
        if (n.includes("~")) periods.push(n.replace(/^(Asia|Americas\s*\/\s*Europe|Amercias\s*\/\s*Europe)\s*서버\s*[:：]\s*/i, ""));
      }
    }
    const taken = [];
    for (const p of periods) {
      const r = efPeriod(p, version);
      if (!r) continue;
      // 지역별로 같은 기간이 한 번 더 나온다(Asia / Americas·Europe, 하루 안쪽 차이) → 처음 것만
      if (taken.some((t) => Math.abs(Date.parse(t) - Date.parse(r.start)) <= 864e5)) continue;
      taken.push(r.start);
      const day = r.start.slice(0, 10);
      const title = heading.replace(/\s*(설명|안내)$/, "");
      out.push({ id: `${idBase}:${title}:${day}`, kind: OFFLINE.test(title) ? "offline" : "event", title, ...r, source: "엔드필드 한국어 공식 공지" });
    }
  }
  return out;
}
/** 엔드필드 공지 목록 → 버전·이벤트·소식 일정 */
export async function endfieldItems() {
  const notices = [];
  for (let p = 1; p <= 20; p++) {
    const d = (await getJson(`${EF_API}?${EF_QUERY}&page=${p}&pageSize=50`)).data;
    if (!d?.list?.length) break;
    notices.push(...d.list);
    if (notices.length >= d.total) break;
  }
  notices.sort((a, b) => a.displayTime - b.displayTime);
  const out = [];
  // 버전: "「X」 버전 업데이트 설명" — 시작 = 점검이 끝나는 시각(Asia 서버), 끝 = 다음 버전 시작
  const versions = [];
  for (const n of notices.filter((n) => /^「[^」]+」\s*버전 업데이트 설명$/.test(n.title ?? ""))) {
    const text = plainText((await getJson(`${EF_API}/${n.cid}?${EF_QUERY}`)).data?.data);
    const maint = text.split("\n").find((l) => /^Asia 서버\s*[:：].*~/.test(l));
    const start = zoned(maint?.split("~")[1] ?? "") ?? new Date(n.displayTime * 1000).toISOString();
    const name = n.title.match(/「([^」]+)」/)[1];
    versions.push({ name, start, startApprox: !maint, text, cid: n.cid });
  }
  for (const [i, v] of versions.entries()) {
    const next = versions[i + 1];
    v.end = next?.start ?? null;
    out.push({ id: `endfield:version:${v.name}`, kind: "version", title: `「${v.name}」 버전`, start: v.start, end: v.end,
      ...(v.startApprox ? { startApprox: true } : {}), ...(v.end ? { endApprox: true } : {}), source: "엔드필드 한국어 공식 공지" });
    out.push(...efSections(v.text, v, `endfield:${v.cid}`));
  }
  const versionAt = (iso) => [...versions].reverse().find((v) => v.start <= iso);
  // 따로 나온 이벤트 공지
  for (const n of notices.filter((n) => /이벤트/.test(n.title ?? "") && !/헤드헌팅|버전 업데이트/.test(n.title))) {
    const text = plainText((await getJson(`${EF_API}/${n.cid}?${EF_QUERY}`)).data?.data);
    const posted = new Date(n.displayTime * 1000).toISOString();
    const found = efSections(text, versionAt(posted), `endfield:${n.cid}`);
    if (found.length) out.push(...found);
  }
  // 외부 행사·소식: 제목으로 고르고 공지 날짜 하루로 둔다(행사 날짜는 공지 글에 제각각이라 추정)
  for (const n of notices.filter((n) => OFFLINE.test(n.title ?? "") && !/헤드헌팅|버전 업데이트 설명/.test(n.title))) {
    const day = new Date(n.displayTime * 1000).toISOString();
    // 글 안에 행사 날짜가 있으면 그 기간으로(없으면 공지 날짜 하루, 추정)
    const text = plainText((await getJson(`${EF_API}/${n.cid}?${EF_QUERY}`)).data?.data);
    const when = datesIn(text, day);
    out.push({ id: `endfield:news:${n.cid}`, kind: "offline", title: n.title.trim(), ...(when ?? { start: day, end: null, startApprox: true }),
      source: "엔드필드 공식 소식", url: `https://endfield.gryphline.com/ko-kr/news/${n.cid}` });
  }
  return dedupe(out);
}

// ───────────────────────── 림버스: 스팀 공식 공지 ─────────────────────────
const LIMBUS_EVENTS = "https://store.steampowered.com/events/ajaxgetpartnereventspageable/?clan_accountid=0&appid=1973530&l=koreana&count_after=100";

/** 스팀 공지 → 이벤트(기간이 있는 공지)·시즌 시작·외부 행사 */
export function limbusItems(data) {
  const out = [];
  for (const e of data?.events ?? []) {
    const name = (e.event_name ?? "").trim();
    const s = e.rtime32_start_time ? new Date(e.rtime32_start_time * 1000).toISOString() : null;
    const t = e.rtime32_end_time ? new Date(e.rtime32_end_time * 1000).toISOString() : null;
    if (!s) continue;
    const url = `https://store.steampowered.com/news/app/1973530/view/${e.gid}`;
    const season = name.match(/시즌\s*(\d+)\s*[:：]?\s*([^에]*?)\s*(?:에 대한|오픈|안내|$)/);
    if (season && /안내|오픈/.test(name)) {
      out.push({ id: `limbus:season:${season[1]}`, kind: "version", title: `시즌 ${season[1]}${season[2] ? ` ${season[2].trim()}` : ""}`, start: s, end: null, startApprox: true, source: "림버스 스팀 공지", url });
      continue;
    }
    if (OFFLINE.test(name)) {
      const when = t && t > s ? null : datesIn(e.announcement_body?.body ?? "", s);
      out.push({ id: `limbus:news:${e.gid}`, kind: "offline", title: name,
        ...(t && t > s ? { start: s, end: t } : when ?? { start: s, end: null, startApprox: true }), source: "림버스 스팀 공지", url });
      continue;
    }
    // 기간이 있는 공지(이벤트·보상 기간). 신규 인격 정보는 픽업이라 배너 자료에서 보여 준다
    if (e.event_type === 35 && t && t > s && !/정보 안내|특정 추출|업데이트 안내/.test(name)) {
      out.push({ id: `limbus:event:${e.gid}`, kind: "event", title: name.replace(/^신규 이벤트\s*-\s*/, ""), start: s, end: t, source: "림버스 스팀 공지", url });
    }
  }
  return out;
}

function dedupe(list) {
  const seen = new Map();
  for (const x of list) if (!seen.has(x.id)) seen.set(x.id, x);
  return [...seen.values()];
}

/** 이번에 모은 일정 + 이전 팩의 일정(공지에서 사라진 지난 일정 보존, 400일 지난 것은 버림) */
export function mergeEvents(current, previous, now = Date.now()) {
  const ids = new Set(current.map((x) => x.id));
  const kept = (previous ?? []).filter((x) => !ids.has(x.id) && Date.parse(x.end ?? x.start) > now - 400 * 864e5);
  return [...current, ...kept].sort((a, b) => a.start.localeCompare(b.start));
}

/** 네 게임 일정 모으기. 한 출처가 실패해도 나머지는 만든다(실패는 errors에) */
export async function collectEvents(previous = {}) {
  const events = {};
  const errors = {};
  const jobs = {
    genshin: async () => genshinItems((await getJson(GENSHIN_ANN)).data),
    arknights: async () => arknightsItems(await getJson(AK_ACTIVITY)),
    endfield: endfieldItems,
    limbus: async () => limbusItems(await getJson(LIMBUS_EVENTS)),
  };
  for (const [game, job] of Object.entries(jobs)) {
    try {
      events[game] = mergeEvents(await job(), previous[game]);
    } catch (e) {
      errors[game] = String(e?.message ?? e);
      events[game] = previous[game] ?? [];
    }
  }
  return { events, errors };
}
