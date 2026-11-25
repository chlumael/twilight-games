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
  return {
    id: `endfield:official:${bulletin.cid}`,
    group: GROUP[kind],
    name: `「${name}」 ${kind} 헤드헌팅`,
    start: serverTime(from),
    end: serverTime(to),
    announced,
    featured: [{ id: `ko:${up[1]}`, ko: up[1] }],
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
  return resolveSchedule(parsed);
}
