// 림버스 "추출 이력" 읽기. 최근 15일 최대 20건, 최신이 맨 위, 시각이 없다(사용자 확인 2026-11-25).
// 그래서 시각 대신 순서로 맞춘다: 이력의 최신 줄들을 앱 기록의 최근 뽑기에 위에서부터 짝짓고,
// 앱이 모르던 줄은 읽은 시각(기기 시각)으로 새로 넣는다(사용자 제안).
import type { ScreenFrame, ScreenLine } from "./recognize";
import type { Pull, Records } from "./types";

export interface LimbusRow {
  /** "쐐기 사무소 대표 오티스" */
  name: string;
  /** 000 인격인지 */
  top: boolean;
}

const SINNERS = ["이상", "파우스트", "돈키호테", "료슈", "뫼르소", "홍루", "히스클리프", "이스마엘", "로쟈", "싱클레어", "오티스", "그레고르"];

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** OCR이 한 글자 틀린 수감자 이름 바로잡기 ("오리스" → "오티스") */
export function sinnerOf(text: string): string | null {
  const t = text.replace(/\s+/g, "");
  if (SINNERS.includes(t)) return t;
  const best = SINNERS.map((s) => ({ s, d: distance(s, t) })).sort((a, b) => a.d - b.d)[0];
  return best.d <= 1 && t.length >= 2 ? best.s : null;
}

/** 추출 이력 화면 → 줄(최신이 앞). 위아래로 잘린 항목은 건너뛴다. */
export function parseLimbusHistory(frame: ScreenFrame, known: string[] = []): LimbusRow[] | null {
  const lines = frame.lines;
  const head = lines.find((l) => /추출\s*이력/.test(l.t));
  const foot = lines.find((l) => /이력이\s*최대/.test(l.t));
  if (!head || !foot) return null;
  // 목록 칸: 수감자 이름이 있는 줄들의 x를 기준으로
  const inList = lines.filter((l) => l.y > head.y + 0.05 && l.y < foot.y && l.x > 0.25 && l.x < 0.6);
  const sinnerLines = inList.filter((l) => sinnerOf(l.t)).sort((a, b) => a.y - b.y);
  const rows: LimbusRow[] = [];
  for (const s of sinnerLines) {
    const above = (l: ScreenLine, max: number) => l.y < s.y && s.y - l.y < max && Math.abs(l.x - s.x) < 0.05;
    const title = inList.filter((l) => l !== s && above(l, 0.06) && !/^0{1,3}$/.test(l.t.trim()) && !sinnerOf(l.t))
      .sort((a, b) => b.y - a.y)[0];
    if (!title) continue; // 위가 잘린 항목
    const grade = inList.find((l) => above(l, 0.1) && l.y < title.y && /^0{1,3}$/.test(l.t.trim().replace(/[oO]/g, "0")));
    const raw = `${title.t.trim()} ${sinnerOf(s.t)}`;
    // 배너 자료에 있는 이름과 한두 글자만 다르면 그 이름으로 바로잡는다 ("쇄기" → "쐐기")
    const fix = known.map((k) => ({ k, d: distance(k.replace(/\s+/g, ""), raw.replace(/\s+/g, "")) })).sort((a, b) => a.d - b.d)[0];
    rows.push({ name: fix && fix.d <= 2 ? fix.k : raw, top: grade?.t.trim().length === 3 });
  }
  return rows;
}

/** 스크롤해서 여러 번 읽은 목록을 겹치는 부분으로 이어 붙인다(최신이 앞). */
export function mergeSequence(have: LimbusRow[], incoming: LimbusRow[]): LimbusRow[] {
  if (!have.length) return incoming;
  if (!incoming.length) return have;
  const same = (a: LimbusRow, b: LimbusRow) => a.name === b.name && a.top === b.top;
  // b가 a의 at 위치부터 겹치면 이어 붙인 결과를 돌려준다
  const join = (a: LimbusRow[], b: LimbusRow[]): LimbusRow[] | null => {
    for (let at = 0; at < a.length; at++) {
      const overlap = Math.min(a.length - at, b.length);
      if (overlap < Math.min(2, b.length, a.length)) break;
      if (b.slice(0, overlap).every((r, k) => same(a[at + k], r))) {
        return [...a.slice(0, at), ...b, ...a.slice(at + b.length)];
      }
    }
    return null;
  };
  return join(have, incoming) ?? join(incoming, have) ?? (incoming.length >= have.length ? incoming : have);
}

export interface LimbusApply {
  records: Records;
  /** 기존 뽑기에 이름·등급을 채운 수 */
  filled: number;
  /** 앱이 모르던 뽑기를 새로 넣은 수 */
  added: number;
  /** 이미 앱에 있던(앞서 채운) 줄 수 */
  known: number;
}

/**
 * 이력(최신이 앞)을 앱 기록에 맞춘다.
 * 1) 앱의 최근 이름 있는 뽑기들과 이력 뒤쪽이 이어지는 곳을 찾아, 그보다 앞의 줄만 "새 정보"로 본다.
 * 2) 새 정보 줄을 앱의 최근 이름 없는 뽑기(재화 감지·직접 입력)에 위에서부터 짝지어 이름·000을 채운다.
 * 3) 남는 줄은 앱이 몰랐던 뽑기라 읽은 시각(기기 시각)으로 새로 넣는다.
 */
export function applyLimbusHistory(records: Records, rows: LimbusRow[], now: Date, newId: () => string): LimbusApply {
  const next = structuredClone(records);
  const rec = next.games.limbus;
  const group = "limbus-extraction";
  const mine = rec.pulls.filter((p) => p.group === group)
    .sort((a, b) => b.time.localeCompare(a.time) || b.indexInSession - a.indexInSession);
  // 1) 이름 있는 뽑기들의 이름 순서(최신이 앞)
  const firstNamed = mine.findIndex((p) => p.name);
  const named = firstNamed >= 0 ? mine.slice(firstNamed).filter((p) => p.name).map((p) => p.name) : [];
  let fresh = rows.length;
  if (named.length) {
    for (let a = 0; a < rows.length; a++) {
      const n = Math.min(3, rows.length - a, named.length);
      if (n > 0 && rows.slice(a, a + n).every((r, k) => r.name === named[k])) { fresh = a; break; }
    }
  }
  const newRows = rows.slice(0, fresh);
  // 2) 가장 최근 이름 있는 뽑기보다 새로운, 이름 없는 뽑기 (최신이 앞)
  const unnamed = (firstNamed >= 0 ? mine.slice(0, firstNamed) : mine).filter((p) => !p.name);
  const pair = Math.min(unnamed.length, newRows.length);
  for (let i = 0; i < pair; i++) {
    const p = rec.pulls.find((x) => x.id === unnamed[i].id)!;
    p.name = newRows[i].name;
    p.top = newRows[i].top;
    p.rarity = newRows[i].top ? 3 : null;
    p.source = "official";
  }
  // 3) 남는 줄 = 앱이 몰랐던 뽑기. 이름 없는 뽑기들보다 오래된 것이므로 그 앞(또는 지금) 시각으로 넣는다
  const extra = newRows.slice(pair).reverse(); // 오래된 것부터
  const base = unnamed.length ? Date.parse(unnamed[unnamed.length - 1].time) - 1000 : now.getTime();
  const session = newId();
  const added: Pull[] = extra.map((r, k) => ({
    id: newId(),
    time: new Date(base - (extra.length - 1 - k)).toISOString(),
    game: "limbus",
    group,
    banner: rec.currentBanner[group] ?? "",
    sessionId: session,
    indexInSession: k,
    top: r.top,
    name: r.name,
    featured: null,
    rarity: r.top ? 3 : null,
    source: "official",
    confidence: 1,
    status: "confirmed",
  }));
  rec.pulls.push(...added);
  return { records: next, filled: pair, added: added.length, known: rows.length - fresh };
}
