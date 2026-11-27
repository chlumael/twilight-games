// 엔드필드 한국어 공식 홈페이지 공지에서 헤드헌팅(픽업) 배너를 읽는다.
// 출처: https://endfield.gryphline.com/ko-kr/news (공식 사이트가 쓰는 공지 자료 주소)
// 공지 글은 데이터로만 다룬다(실행하지 않음). 형식이 바뀌면 여기 규칙을 고친다.

const API = "https://web-news.gryphline.com/api/bulletin";
const QUERY = "lang=ko-kr&code=arknights_endfield_official";
const GROUP = { "특별 허가": "endfield-chartered", "재구축": "endfield-refactor" };

/** 공지 본문(HTML)을 줄 단위 글로 바꾼다. */
export function plainText(html) {
  return String(html ?? "")
    .replace(/<\/?(p|div|br|li|ul|ol|h\d|tr|table|section|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "") // 굵게·색 같은 글자 꾸밈 태그는 줄을 나누지 않는다
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t ]+/g, " ")
    .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

/** "2026/12/23 11:59" (Asia 서버 시간, UTC+8) → ISO 시각 */
function serverTime(s) {
  const m = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const p = (x) => String(x).padStart(2, "0");
  return new Date(`${y}-${p(mo)}-${p(d)}T${p(h)}:${mi}:00+08:00`).toISOString();
}

/**
 * 공지 한 건에서 캐릭터 헤드헌팅 배너를 뽑는다.
 * 헤드헌팅 공지가 아니거나 픽업 캐릭터를 못 찾으면 null.
 * start/end는 공지에 날짜가 적힌 쪽만 채운다("버전 업데이트 후/전까지"는 null).
 */
export function parseNotice(bulletin) {
  const title = bulletin.title ?? "";
  const head = title.match(/「([^」]+)」\s*(특별 허가|재구축) 헤드헌팅/);
  if (!head) return null;
  const [, name, kind] = head;
  const text = plainText(bulletin.data);
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const up = text.match(new RegExp(`「${esc}」\\s*${kind} 헤드헌팅[^\\n\\[]*6성 오퍼레이터[^\\n\\[]*\\[([^\\]]+)\\]`));
  if (!up) return null;
  // 기간 줄: "A ~ B" 꼴이고 "서버 시간"이 들어 있다. Asia 서버 줄을 우선한다.
  const periods = text.split("\n").filter((l) => l.includes("~") && l.includes("서버 시간") && !l.startsWith("※"));
  const line = periods.find((l) => /Asia/i.test(l)) ?? periods[0] ?? "";
  const [from = "", to = ""] = line.split("~");
  const announced = new Date(bulletin.displayTime * 1000).toISOString();
  // "획득 가능 6성 오퍼레이터 목록: 가/나/다" → 픽업을 뺀 나머지(픽뚫 후보)
  // 공지마다 "획득 가능 6성…" / "획득 가능한 6성…" 두 가지로 적힌다
  const listLine = text.split("\n").find((l) => /획득 가능한? 6성 오퍼레이터 목록/.test(l));
  const pool = (listLine?.split(/목록\s*[:：]/)[1] ?? "").split("/").map((n) => n.trim()).filter((n) => n && n !== up[1]);
  return {
    id: `endfield:official:${bulletin.cid}`,
    group: GROUP[kind],
    name: `「${name}」 ${kind} 헤드헌팅`,
    start: serverTime(from),
    end: serverTime(to),
    announced,
    featured: [{ id: `ko:${up[1]}`, ko: up[1] }],
    ...(pool.length ? { pool: pool.map((ko) => ({ id: `ko:${ko}`, ko })) } : {}),
  };
}

/**
 * 공지에 날짜가 없는 쪽을 채운다.
 * - 시작이 "버전 업데이트 후": 공지 게시 시각을 쓴다(실제 시작과 하루쯤 다를 수 있어 startApprox 표시).
 * - 종료가 "버전 업데이트 전까지": 그 뒤 첫 "버전 업데이트 후" 배너의 시작(=다음 버전 업데이트 무렵)을 쓴다.
 *   그런 배너가 없으면 같은 종류의 다음 배너 시작, 그것도 없으면 null(진행 중).
 */
export function resolveSchedule(parsed) {
  const list = [...parsed].sort((a, b) => a.announced.localeCompare(b.announced));
  const out = list.map((b) => ({ ...b, start: b.start ?? b.announced, startApprox: b.start === null }));
  for (const [i, b] of out.entries()) {
    if (b.end) continue;
    const later = out.slice(i + 1).filter((n) => n.start > b.start);
    const next = later.find((n) => n.startApprox) ?? later.find((n) => n.group === b.group);
    b.end = next ? next.start : null;
    b.endApprox = !!next;
  }
  return out.map(({ announced, startApprox, endApprox, ...b }) => ({
    ...b,
    version: null,
    source: "엔드필드 한국어 공식 홈페이지 공지",
    featuredRare: [],
    ...(startApprox ? { startApprox: true } : {}),
    ...(endApprox ? { endApprox: true } : {}),
  }));
}

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": "twilight-games-banner-pack" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const body = await res.json();
  if (body.code !== 0) throw new Error(`공지 응답 오류 ${body.code} ${url}`);
  return body.data;
}

/** 공식 공지 전체에서 헤드헌팅 배너 목록을 만든다. */
/**
 * 공지 본문에서 6성 오퍼레이터 이름을 모은다: "획득 가능 6성 오퍼레이터 목록: 케르/명하/…"와 픽업 6성.
 * 공식 기록 화면에는 등급이 글자로 안 나와서, 이름으로 6성인지 판단하는 데 쓴다.
 */
export function sixStarNames(html) {
  const text = plainText(html);
  const names = new Set();
  for (const m of text.matchAll(/6성 오퍼레이터 목록\s*[:：]\s*([^\n]+)/g)) {
    for (const n of m[1].split("/")) if (n.trim()) names.add(n.trim());
  }
  for (const m of text.matchAll(/6성 오퍼레이터\s*\[([^\]]+)\]/g)) names.add(m[1].trim());
  return [...names];
}

/** 마지막으로 모은 6성 이름 (build.mjs가 파일로 저장) */
export const collectedSixStars = new Set();

/**
 * 「확률 상세 안내」 공지에서 지금 열려 있는 캐릭터 배너의 6성 목록을 뽑는다.
 * 구간 제목 "「이름」 헤드헌팅 확률 상세 안내"(특별 허가) / "「이름」 재구축 헤드헌팅#N 확률 상세 안내" 아래
 * "[6성 오퍼레이터]" 표에서 "6성 오퍼레이터" 줄 바로 다음 줄이 이름이고, "(UP)"이 픽업이다.
 * 재구축 헤드헌팅 공지에는 목록 줄이 없어서 이 표가 유일한 출처다.
 */
export function parseHeadhuntPools(text) {
  const lines = String(text).split("\n");
  const heads = lines.map((l, i) => ({ m: l.match(/^「([^」]+)」\s*(재구축 )?헤드헌팅(?:#\d+)?\s*확률 상세 안내$/), i })).filter((h) => h.m);
  const out = [];
  for (const h of heads) {
    const from = lines.indexOf("[6성 오퍼레이터]", h.i);
    const to = lines.findIndex((l, i) => i > from && /^\[\d성 오퍼레이터\]$/.test(l));
    if (from < 0 || to < 0 || lines.slice(h.i + 1, from).some((l) => /확률 상세 안내$/.test(l))) continue;
    let featured = null;
    const pool = [];
    for (let i = from + 1; i < to - 1; i++) {
      if (lines[i] !== "6성 오퍼레이터") continue;
      const raw = lines[i + 1].trim();
      const nm = raw.replace(/\s*\(UP\)$/, "").trim();
      if (!nm || nm === "오퍼레이터 성급" || /%/.test(nm)) continue;
      if (/\(UP\)$/.test(raw)) featured = nm;
      else if (!pool.includes(nm)) pool.push(nm);
    }
    if (featured) out.push({ name: `「${h.m[1]}」 ${h.m[2] ? "재구축" : "특별 허가"} 헤드헌팅`, featured, pool });
  }
  return out;
}

/**
 * 「확률 상세 안내」 공지에서 지금 열려 있는 무기 배너(무기고 신청·재구축 신청)를 뽑는다.
 * 구간 제목 "X 신청 확률 상세 안내" 아래에서 "(UP)"이 붙은 6성 무기가 픽업이다. 상시 무기 배너("개방 시간" 줄 없음)는 뺀다.
 * 날짜가 적힌 구간만 기간을 채우고("A ~ B"), 아니면 시작·종료를 비워 둔다(이전 팩과 합칠 때 채움).
 */
export function parseArsenal(text) {
  const lines = String(text).split("\n");
  const heads = lines.map((l, i) => ({ m: l.match(/^(\S+ 신청) 확률 상세 안내$/), i })).filter((h) => h.m);
  const out = [];
  for (const [k, h] of heads.entries()) {
    const body = lines.slice(h.i + 1, heads[k + 1]?.i ?? lines.length);
    const up = body.find((l) => / \(UP\)$/.test(l));
    if (!up) continue;
    // 기간이 적힌 것만 넣는다: 한정 캐릭터와 함께 열리는 무기고 신청·재구축 신청.
    // "개방 시간" 줄이 없는 것은 늘 열려 있는 상시 무기 배너라 추적하지 않는다(사용자 2026-11-26).
    if (!body.slice(0, 3).some((l) => l.startsWith("개방 시간"))) continue;
    const name = h.m[1];
    const refactor = body.slice(0, 40).some((l) => l.includes(`「${name}」 재구축 신청`)) || lines.slice(Math.max(0, h.i - 3), h.i).some((l) => l.includes(`「${name}」 재구축 신청`));
    const period = body.slice(0, 3).find((l) => l.startsWith("개방 시간") && l.includes("~")) ?? "";
    const [from = "", to = ""] = period.split("~");
    const weapon = up.replace(/ \(UP\)$/, "").trim();
    // 이 배너에서 나올 수 있는 다른 6성 무기(픽뚫 후보): "[6성 무기]" 표에서 "6성 무기" 줄 바로 다음 줄이 이름
    const from6 = body.indexOf("[6성 무기]");
    const to6 = body.findIndex((l, i) => i > from6 && /^\[\d성 무기\]$/.test(l));
    const table = from6 >= 0 ? body.slice(from6 + 1, to6 > from6 ? to6 : body.length) : [];
    const pool = [];
    for (let i = 0; i < table.length - 1; i++) {
      if (table[i] !== "6성 무기") continue;
      const nm = table[i + 1].replace(/ \(UP\)$/, "").trim();
      if (!nm || nm === "무기 희귀도" || nm === weapon || /%|^·/.test(nm) || pool.includes(nm)) continue;
      pool.push(nm);
    }
    out.push({
      id: `endfield:arsenal:${name}`,
      group: refactor ? "endfield-refactor-arsenal" : "endfield-arsenal",
      name: `「${name}」${refactor ? " 재구축 신청" : ""}`,
      start: serverTime(from),
      end: serverTime(to),
      version: null,
      source: "엔드필드 한국어 공식 홈페이지 공지(확률 상세 안내)",
      featured: [{ id: `ko:${weapon}`, ko: weapon }],
      featuredRare: [],
      // 픽업이 아닌 6성 무기 목록(직접 입력의 이름 후보·픽뚫 판정에 쓴다)
      pool: pool.map((ko) => ({ id: `ko:${ko}`, ko })),
    });
  }
  return out;
}

/**
 * 이번에 읽은 무기 배너와 이전 팩의 무기 배너를 합친다(확률 상세 안내에는 지금 열린 것만 나오므로).
 * - 새로 보인 배너에 시작일이 없으면 처음 본 시각을 쓴다(startApprox).
 * - 이전에 있었는데 이번에 안 보이면 끝난 것: 종료일이 없으면 지금 시각으로(endApprox).
 */
export function mergeArsenal(current, previous, nowIso) {
  const prev = new Map(previous.map((b) => [b.id, b]));
  const out = current.map((b) => {
    const old = prev.get(b.id);
    prev.delete(b.id);
    if (b.start) return b;
    return old?.start ? { ...b, start: old.start, ...(old.startApprox ? { startApprox: true } : {}) } : { ...b, start: nowIso, startApprox: true };
  });
  for (const old of prev.values()) out.push(old.end ? old : { ...old, end: nowIso, endApprox: true });
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * 「X 신청」 기간 한정 판매 설명 공지 한 건 → 무기고 신청 배너. 무기고 신청마다 이 공지가 따로 있다(2026-11-26 확인).
 * - 픽업: "확률 증가 6성 무기: [이름(무기 종류)]" — 괄호 안 무기 종류는 뗀다(「확률 상세 안내」 표기와 맞춤)
 * - 6성 목록: "획득 가능(한) 6성 무기 목록: a(종류)/b(종류)/…"
 * - 시작: "개방 시간(기간): 2026/11/05 12:00(서버 시간) 개방" 꼴이면 그 시각, 날짜가 없으면 공지 시각(startApprox)
 * - 종료: "「특별 허가 헤드헌팅」 3회 진행 후 종료(「이름」부터 집계)" → { from: 이름, count: 3 }. 실제 시각은 resolveArsenalEnds가 채운다
 */
export function parseArsenalNotice(bulletin) {
  const head = (bulletin.title ?? "").match(/^「([^」]+ 신청)」\s*기간 한정 판매/);
  if (!head) return null;
  const name = head[1];
  const text = plainText(bulletin.data);
  const lines = text.split("\n");
  const strip = (n) => n.replace(/\([^)]*\)\s*$/, "").trim();
  // 픽업: "확률 증가 6성 무기: [X]" 줄, 없으면 첫 문장 "6성 무기 [X]의 획득 확률이 증가"
  const upLine = lines.find((l) => /확률 증가\S* 6성 무기\s*[:：]/.test(l)) ?? lines.find((l) => /6성 무기 \[[^\]]+\]의 획득 확률이 증가/.test(l));
  const up = upLine?.match(/\[([^\]]+)\]/)?.[1];
  if (!up) return null;
  const weapon = strip(up);
  const listLine = lines.find((l) => /획득 가능한? 6성 무기 목록/.test(l));
  const pool = (listLine?.split(/목록\s*[:：]/)[1] ?? "").replace(/\.\s*$/, "").split("/").map(strip).filter((n) => n && n !== weapon);
  // 기간: "개방 시간(기간):" 줄. 그 줄이 비어 있으면 다음 "·" 줄 전까지에서 Asia 서버 줄(없으면 날짜가 있는 줄)
  const at = lines.findIndex((l) => /개방 (시간|기간)\s*[:：]/.test(l));
  let period = at >= 0 ? lines[at].replace(/^.*개방 (시간|기간)\s*[:：]\s*/, "") : "";
  if (at >= 0 && !period) {
    const block = [];
    for (const l of lines.slice(at + 1)) { if (l.startsWith("·") || l.startsWith("▼")) break; block.push(l); }
    period = block.find((l) => /^Asia 서버\s*[:：]/.test(l)) ?? block.find((l) => /\d{4}\/\d/.test(l) || /종료/.test(l)) ?? "";
  }
  const start = serverTime(period.split("~")[0].split("개방")[0]);
  // 종료 규칙 세 가지: "특별 허가 3회 진행 후 종료(「X」부터 집계)", "「X」(을) 기준으로 3회의 「특별 허가」 이후 종료",
  // "「X」 특수 헤드헌팅 진행 후 종료"(그다음 특별 허가가 열릴 때까지로 본다)
  const m1 = period.match(/특별 허가 헤드헌팅」\s*(\d+)회 진행 후 종료\s*\(「([^」]+)」부터/);
  const m2 = period.match(/「([^」]+)」\s*(?:을|를)?\s*기준으로\s*(\d+)회의\s*「특별 허가 헤드헌팅」/);
  const m3 = /특수 헤드헌팅 진행 후 종료/.test(period);
  const rule = m1 ? [null, m1[1], m1[2]] : m2 ? [null, m2[2], m2[1]] : m3 ? [null, "0", ""] : null;
  const announced = new Date(bulletin.displayTime * 1000).toISOString();
  return {
    id: `endfield:arsenal:${name}`,
    group: "endfield-arsenal",
    name: `「${name}」`,
    start: start ?? announced,
    ...(start ? {} : { startApprox: true }),
    end: serverTime(period.split("~")[1] ?? ""),
    version: null,
    source: "엔드필드 한국어 공식 홈페이지 공지(무기고 신청 설명)",
    featured: [{ id: `ko:${weapon}`, ko: weapon }],
    featuredRare: [],
    pool: pool.map((ko) => ({ id: `ko:${ko}`, ko })),
    ...(rule ? { endRule: { count: Number(rule[1]), from: rule[2] } } : {}),
  };
}

/**
 * "특별 허가 3회 진행 후 종료(「A」부터 집계)" → A부터 세어 3번째 특별 허가 배너가 끝나는 시각.
 * 그 배너가 아직 공지되지 않았으면 종료일 없음(진행 중). 처리한 뒤 endRule은 지운다.
 */
export function resolveArsenalEnds(arsenal, chartered) {
  const list = [...chartered].sort((a, b) => a.start.localeCompare(b.start));
  return arsenal.map(({ endRule, ...b }) => {
    if (b.end || !endRule) return b;
    if (endRule.count === 0) {
      // 특수 헤드헌팅과 함께 끝나는 것: 그 뒤 처음 열리는 특별 허가의 시작을 종료로 본다(근사값)
      const next = list.find((c) => c.start > b.start);
      return next ? { ...b, end: next.start, endApprox: true } : b;
    }
    const i = list.findIndex((c) => c.name.startsWith(`「${endRule.from}」`));
    const last = i >= 0 ? list[i + endRule.count - 1] : undefined;
    return last?.end ? { ...b, end: last.end, ...(last.endApprox ? { endApprox: true } : {}) } : b;
  });
}

/**
 * 배너 그림: 공지 목록의 표지(cover)를 배너 이름의 「…」로 맞춰 붙인다(최신 공지 먼저).
 * 앱은 줄인 사본(data/images)을 쓴다 — scripts/images.
 */
export function withCovers(banners, notices) {
  const cover = new Map();
  for (const n of notices) {
    if (!/^https:\/\//.test(n.cover ?? "")) continue;
    for (const m of String(n.title ?? "").matchAll(/「([^」]+)」/g)) if (!cover.has(m[1])) cover.set(m[1], n.cover);
  }
  return banners.map((b) => {
    // 재구축 신청(무기 복각)은 공지를 다른 배너와 같이 써서 엉뚱한 표지가 붙는다 → 그림 없음
    if (b.group === "endfield-refactor-arsenal") return b;
    const key = b.name.match(/「([^」]+)」/)?.[1];
    return key && cover.has(key) && !b.image ? { ...b, image: cover.get(key) } : b;
  });
}

/** 해석하지 못한 헤드헌팅 공지 제목 (빌드 결과에 경고로 남긴다) */
export const skippedNotices = [];

export async function endfieldOfficial() {
  const notices = [];
  for (let page = 1; page <= 20; page++) {
    const data = await get(`${API}?${QUERY}&page=${page}&pageSize=50&tabs[]=notices`);
    notices.push(...data.list);
    if (!data.list.length || notices.length >= data.total) break;
  }
  const parsed = [];
  const skipped = [];
  // 무기고 신청: 신청마다 있는 "기간 한정 판매 설명" 공지에서
  const arsenalNotices = [];
  for (const n of notices.filter((n) => /^「[^」]+ 신청」\s*기간 한정 판매/.test(n.title ?? ""))) {
    const b = parseArsenalNotice(await get(`${API}/${n.cid}?${QUERY}`));
    if (b) arsenalNotices.push(b);
    else skippedNotices.push(n.title);
  }
  for (const n of notices.filter((n) => n.title?.includes("헤드헌팅"))) {
    const detail = await get(`${API}/${n.cid}?${QUERY}`);
    for (const name of sixStarNames(detail.data)) collectedSixStars.add(name);
    const b = parseNotice(detail);
    if (b) parsed.push(b);
    else skipped.push(n.title);
  }
  if (skipped.length) console.warn("엔드필드: 해석하지 못한 헤드헌팅 공지 →", skipped.join(" | "));
  skippedNotices.push(...skipped);
  // 무기 배너: 「확률 상세 안내」 공지 한 건에서
  let arsenal = [];
  const odds = notices.find((n) => n.title?.trim() === "확률 상세 안내");
  if (odds) {
    const text = plainText((await get(`${API}/${odds.cid}?${QUERY}`)).data);
    arsenal = parseArsenal(text);
    // 지금 열린 캐릭터 배너의 6성 목록: 공지에 목록 줄이 없는 배너(재구축)만 채운다. 이름·픽업이 같을 때만.
    for (const p of parseHeadhuntPools(text)) {
      const b = parsed.find((x) => x.name === p.name && x.featured[0]?.ko === p.featured);
      if (b && !b.pool && p.pool.length) b.pool = p.pool.map((ko) => ({ id: `ko:${ko}`, ko }));
    }
  } else skippedNotices.push("확률 상세 안내(무기 배너) 공지를 찾지 못함");
  const heads = resolveSchedule(parsed);
  // 무기고 신청은 전용 공지가 정본이다. 「확률 상세 안내」에서는 재구축 신청만 쓴다(무기고 신청 공지에 없는 것만 보충)
  const own = new Set(arsenalNotices.map((b) => b.id));
  const extra = arsenal.filter((b) => b.group === "endfield-refactor-arsenal" || !own.has(b.id));
  const timed = resolveArsenalEnds(arsenalNotices, heads.filter((b) => b.group === "endfield-chartered"));
  return withCovers([...heads, ...timed, ...extra], notices);
}
