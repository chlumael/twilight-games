// 명일방주(한국 서버): 게임 내 공식 공지의 헤드헌팅 배너 그림에서 배너를 읽는다.
//   공지 목록  https://ak-webview.arknights.kr/api/game/bulletinList  (제목: "한정 헤드헌팅" / "일반 헤드헌팅")
//   공지 본문  글 없이 배너 그림 한 장 + 뽑기 화면으로 가는 링크(풀 ID)
// 그림 속 글자는 ocr_image.py(rapidocr)로 읽는다. 확신이 낮은 글자는 버린다(틀린 정보보다 빈칸이 낫다).
// 공지에는 진행 중인 배너만 있으므로 지난 배너는 이전 팩에서 이어받는다.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const API = "https://ak-webview.arknights.kr/api/game";
const GROUP = { "한정 헤드헌팅": "arknights-limited", "일반 헤드헌팅": "arknights-standard" };
const SOURCE = "명일방주 게임 내 공식 공지";
const SURE = 0.95; // 이 점수 이상으로 읽힌 글자만 쓴다
const NOT_NAME = /바로가기|이벤트|기간|확률|헤드헌팅|캐릭터|오퍼레이터|명일방주|상기/;

/** 공지 제목 → 그룹. 커널 헤드헌팅 등 다루지 않는 종류는 null */
export function noticeGroup(title) {
  return GROUP[String(title ?? "").replace(/\\n|\s+/g, " ").trim()] ?? null;
}

/** 링크 "uniwebview://move?target=recruit&param1=DOUBLE_KR_42_0_6" → 풀 ID */
export function poolId(jumpLink) {
  return String(jumpLink ?? "").match(/[?&]param1=([A-Z0-9_]+)/)?.[1] ?? null;
}

/**
 * "이벤트기간:11월20일 04:00~12월 4일 03:59" → { start, end } (한국 시간).
 * 연도는 공지 날짜에서 가져오고, 종료 달이 시작 달보다 작으면 다음 해로 본다.
 */
export function parsePeriod(lines, noticeDate) {
  const year = Number(String(noticeDate).slice(0, 4));
  for (const l of lines) {
    if (l.score < 0.9) continue;
    const m = l.text.match(/(\d{1,2})월\s*(\d{1,2})일\s*(\d{2}):(\d{2})\s*~\s*(\d{1,2})월\s*(\d{1,2})일\s*(\d{2}):(\d{2})/);
    if (!m) continue;
    const [m1, d1, h1, n1, m2, d2, h2, n2] = m.slice(1).map(Number);
    const iso = (y, mo, d, h, n) => {
      const p = (x) => String(x).padStart(2, "0");
      const t = new Date(`${y}-${p(mo)}-${p(d)}T${p(h)}:${p(n)}:00+09:00`);
      return Number.isNaN(t.getTime()) ? null : t.toISOString();
    };
    const start = iso(year, m1, d1, h1, n1);
    const end = iso(m2 < m1 ? year + 1 : year, m2, d2, h2, n2);
    if (start && end && end > start) return { start, end };
  }
  return null;
}

/**
 * 그림에서 읽은 글자 → 픽업 이름. 글씨가 큰 쪽이 6성, 작은 쪽이 5성이다.
 * 확신이 낮은 줄이 하나라도 이름처럼 보이면 unsure=true (사람 확인 필요).
 */
export function parseNames(lines) {
  const candidates = lines.filter((l) => /[가-힣]/.test(l.text) && !NOT_NAME.test(l.text) && !/\d{1,2}월/.test(l.text));
  const sure = candidates.filter((l) => l.score >= SURE);
  const tallest = Math.max(0, ...sure.map((l) => l.h));
  const pick = (top) => sure
    .filter((l) => (l.h >= tallest * 0.75) === top)
    .sort((a, b) => a.x - b.x)
    .map((l) => ({ id: `ko:${l.text.trim()}`, ko: l.text.trim() }));
  return { featured: pick(true), featuredRare: pick(false), unsure: sure.length < candidates.length };
}

/**
 * 공지 한 건 + 글자 인식 결과 → 배너. override는 사람이 그림을 보고 적어 둔 값(같은 풀 ID).
 */
export function buildBanner(notice, lines, override = {}) {
  const pool = poolId(notice.jumpLink);
  // 풀 ID가 LINKAGE로 시작하면 콜라보(공지 제목은 "한정 헤드헌팅"으로 나온다) — 추정
  const group = pool?.startsWith("LINKAGE") && noticeGroup(notice.title) ? "arknights-collab" : noticeGroup(notice.title);
  if (!group || !pool) return null;
  const kind = String(notice.title).replace(/\\n|\s+/g, " ").trim();
  const period = parsePeriod(lines, notice.displayTime);
  const names = parseNames(lines);
  const start = override.start ?? period?.start ?? null;
  const end = override.end ?? period?.end ?? null;
  const featured = override.featured ?? names.featured;
  const needsReview = !override.featured && (names.unsure || !featured.length) || !(start && end);
  return {
    id: `arknights:official:${pool}`,
    group,
    name: group === "arknights-collab" ? "콜라보 헤드헌팅" : kind,
    // 기간을 못 읽으면 공지 날짜(한국 시간 0시)를 시작으로 두고 근사값으로 표시한다
    start: start ?? new Date(`${notice.displayTime}T00:00:00+09:00`).toISOString(),
    ...(start ? {} : { startApprox: true }),
    end,
    version: null,
    source: SOURCE,
    featured,
    featuredRare: override.featuredRare ?? names.featuredRare,
    ...(needsReview ? { needsReview: true } : {}),
  };
}

/** 새로 읽은 배너와 이전 팩을 합친다. 같은 ID는 새 것이 이기되, 새 것이 확인 필요이고 옛 것이 아니면 옛 것을 둔다. */
export function mergeBanners(previous, fresh) {
  const byId = new Map((previous ?? []).map((b) => [b.id, b]));
  for (const b of fresh) {
    const old = byId.get(b.id);
    if (!old || !b.needsReview || old.needsReview) byId.set(b.id, b);
  }
  return [...byId.values()].sort((a, b) => a.start.localeCompare(b.start));
}

const run = promisify(execFile);

async function get(path) {
  const res = await fetch(`${API}/${path}`, { headers: { "User-Agent": "twilight-games-banner-pack" } });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  const body = await res.json();
  if (body.code !== 0) throw new Error(`명일방주 공지 응답 오류 ${body.code}`);
  return body.data;
}

export async function arknightsOfficial() {
  const read = (rel, pick) => readFile(new URL(rel, import.meta.url), "utf8").then((t) => pick(JSON.parse(t))).catch(() => null);
  const previous = (await read("../../data/banners.json", (p) => p.games?.arknights)) ?? [];
  const overrides = (await read("../../data/names/arknights-banners.json", (p) => p.pools)) ?? {};
  const list = (await get("bulletinList?target=Android")).list.filter((n) => noticeGroup(n.title));
  const fresh = [];
  const dir = await mkdtemp(join(tmpdir(), "arknights-"));
  try {
    for (const item of list) {
      const notice = await get(`bulletin/${item.cid}`);
      const pool = poolId(notice.jumpLink);
      const known = previous.find((b) => b.id === `arknights:official:${pool}`);
      if (known && !known.needsReview && !overrides[pool]) continue; // 이미 제대로 읽은 배너
      let lines = [];
      try {
        const img = await fetch(notice.bannerImageUrl);
        if (!img.ok) throw new Error(`${img.status} 그림`);
        const file = join(dir, "banner.jpg");
        await writeFile(file, Buffer.from(await img.arrayBuffer()));
        const script = new URL("./ocr_image.py", import.meta.url).pathname;
        lines = JSON.parse((await run("python3", [script, file], { maxBuffer: 1 << 22 })).stdout);
      } catch (e) {
        console.warn(`명일방주: ${pool} 그림을 읽지 못함 (${String(e.message).split("\n")[0]})`);
      }
      const banner = buildBanner(notice, lines, overrides[pool]);
      if (banner) fresh.push(banner);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const merged = mergeBanners(previous, fresh);
  const review = merged.filter((b) => b.needsReview).map((b) => b.id.split(":").pop());
  if (review.length) console.warn(`명일방주: 사람이 확인해야 하는 배너 → ${review.join(", ")} (data/names/arknights-banners.json)`);
  return merged;
}
