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
  return [...resolveSchedule(parsed), ...arsenal];
}
