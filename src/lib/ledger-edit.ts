// 직접 입력·고치기·지우기: n번째 최고 등급, 횟수 맞추기, 교환·무료 뽑기, 기록 묶음 지우기, 최고 등급 고치기 (정리 2026-11-27: ledger.ts에서 나눔)
import { GAMES, findGroup } from "./games";
import type { GameId, GameRecord, Pull, Records } from "./types";
import { byTime, newId, pushUndo, groupStatus, topHistory, recordSession, repairBaselines, emptyBaseline, seriesOf, type TopInfo } from "./ledger-core";

/**
 * 직접 입력: "이 배너에서 n번째 뽑기에 최고 등급(이름)이 나왔다" — n은 **배너 누적**(사용자 결정 2026-11-26).
 * 예: 58 → 92 → 120 순서로 넣으면 차이(34, 28)만큼만 뽑기를 더한다.
 * - n이 지금 배너 누적보다 크면: 모자란 뽑기를 더하고 마지막을 최고 등급으로 (mode "added")
 * - 이미 기록된 뽑기 자리면: 그 자리를 최고 등급으로 표시 (mode "marked")
 * - 앱 기록 전 구간(시작 상태의 배너 뽑기 수 안)이면 바꾸지 않는다 (mode "before")
 * - 더하면 천장을 넘는 경우(그 사이에 다른 최고 등급이 있었을 것)면 바꾸지 않는다 (mode "too-far")
 * 묶음 단위(엔드필드 무기 신청)는 10의 배수로 올린다. 픽업 여부는 배너의 픽업 이름과 같은지로 정해서 넘긴다.
 */
export function recordTopAt(
  records: Records,
  game: GameId,
  groupId: string,
  n: number,
  info: TopInfo,
  now: Date = new Date(),
): { records: Records; mode: "added" | "marked" | "before" | "too-far" | "invalid" } {
  const rec = records.games[game];
  const group = findGroup(game, groupId);
  const unit = group.odds?.unit ?? 1;
  n = Math.ceil(n / unit) * unit;
  if (!Number.isInteger(n) || n < 1 || n > 2000) return { records, mode: "invalid" };
  const st = groupStatus(rec, game, groupId);
  const banner = st.banner;
  const base = rec.baseline[groupId];
  const before = base && base.banner === banner ? base.bannerPulls : 0; // 앱이 못 본 배너 뽑기
  const onBanner = rec.pulls
    .filter((p) => p.group === groupId && (p.banner === banner || (group.counterScope === "series" && !!banner && seriesOf(p.banner) === seriesOf(banner))))
    .sort(byTime);
  if (n > st.bannerPulls) {
    const add = n - st.bannerPulls;
    if (group.hardPity !== null && st.pity + add > group.hardPity) return { records, mode: "too-far" };
    const next = recordSession(records, game, groupId, add, new Map([[add - 1, info]]), now);
    // 지난 뽑기를 뒤늦게 적는 것이므로 지금 보유 재화는 깎지 않는다
    next.games[game].currency = { ...rec.currency };
    const last = next.undo[next.undo.length - 1];
    if (last) last.label = `${GAMES[game].shortName} 배너 ${n}번째 ${info.name ?? GAMES[game].topLabel} 직접 입력`;
    return { records: next, mode: "added" };
  }
  if (n <= before) return { records, mode: "before" };
  const target = onBanner[n - before - 1];
  if (!target) return { records, mode: "invalid" };
  const next = structuredClone(records);
  const p = next.games[game].pulls.find((x) => x.id === target.id)!;
  const old = structuredClone(p);
  p.top = true;
  p.name = info.name;
  p.featured = info.featured;
  pushUndo(next, { game, label: `${GAMES[game].shortName} 배너 ${n}번째 ${info.name ?? GAMES[game].topLabel} 표시`, addedPullIds: [], replacedPulls: [old], prevCurrency: { ...next.games[game].currency } });
  return { records: next, mode: "marked" };
}

/** 기록 묶음(한 번에 기록된 뽑기들) — 기록 정리 화면용. 최근 것부터 */
export interface PullBatch {
  sessionId: string;
  group: string;
  time: string;
  count: number;
  source: Pull["source"];
  tops: string[];
}

export function pullBatches(rec: GameRecord): PullBatch[] {
  const map = new Map<string, PullBatch>();
  for (const p of rec.pulls) {
    const key = `${p.sessionId}|${p.group}|${p.source}`;
    const b = map.get(key) ?? { sessionId: key, group: p.group, time: p.time, count: 0, source: p.source, tops: [] };
    b.count++;
    if (p.time < b.time) b.time = p.time;
    if (p.top) b.tops.push(p.name ?? "이름 없음");
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => (a.time < b.time ? 1 : -1));
}

/** 기록 묶음을 지운다(되돌리기 가능). keys = pullBatches의 sessionId */
export function removeBatches(records: Records, game: GameId, keys: string[], label: string): Records {
  const want = new Set(keys);
  const next = structuredClone(records);
  const rec = next.games[game];
  const gone = rec.pulls.filter((p) => want.has(`${p.sessionId}|${p.group}|${p.source}`));
  if (!gone.length) return records;
  const ids = new Set(gone.map((p) => p.id));
  rec.pulls = rec.pulls.filter((p) => !ids.has(p.id));
  pushUndo(next, { game, label, addedPullIds: [], replacedPulls: gone, prevCurrency: { ...rec.currency } });
  return repairBaselines(next);
}

/** 교환으로 얻은 최고 등급을 기록한다(뽑기 수·천장에는 영향 없음, 교환 재화만 줄어든다) */
export function recordExchange(records: Records, game: GameId, groupId: string, name: string | null, now: Date = new Date(), option?: { cost: number; low?: boolean }): Records {
  const next = structuredClone(records);
  const rec = next.games[game];
  rec.exchanges = [...(rec.exchanges ?? []), {
    id: newId(), time: now.toISOString(), group: groupId, banner: rec.currentBanner[groupId] ?? "", name,
    ...(option ? { cost: option.cost } : {}), ...(option?.low ? { low: true } : {}),
  }];
  return next;
}

/**
 * 무료 뽑기(엔드필드 긴급 모집)에서 나온 최고 등급을 기록한다.
 * 공식 규칙: 긴급 모집은 천장 횟수·누적 횟수에 들어가지 않는다 → 뽑기 수·천장·재화(허가증·오로베릴)는 그대로 두고,
 * 오퍼레이터를 얻을 때 함께 받는 재화(무기고 징표 6성분)만 더한다.
 */
export function recordFreeTop(records: Records, game: GameId, groupId: string, info: TopInfo, now: Date = new Date()): Records {
  const next = structuredClone(records);
  const rec = next.games[game];
  const group = GAMES[game].groups.find((g) => g.id === groupId);
  if (!group?.freeLabel) return records;
  rec.exchanges = [...(rec.exchanges ?? []), {
    id: newId(), time: now.toISOString(), group: groupId, banner: rec.currentBanner[groupId] ?? "",
    name: info.name ?? null, kind: "free", featured: info.featured ?? null,
  }];
  if (group.gain) rec.currency[group.gain.key] = (rec.currency[group.gain.key] ?? 0) + group.gain.top;
  return next;
}

export function removeExchange(records: Records, game: GameId, id: string): Records {
  const next = structuredClone(records);
  const rec = next.games[game];
  const gone = (rec.exchanges ?? []).find((e) => e.id === id);
  rec.exchanges = (rec.exchanges ?? []).filter((e) => e.id !== id);
  // 무료 뽑기 기록을 지우면 그때 더한 재화도 되돌린다
  const gain = gone?.kind === "free" ? GAMES[game].groups.find((g) => g.id === gone.group)?.gain : undefined;
  if (gain) rec.currency[gain.key] = Math.max(0, (rec.currency[gain.key] ?? 0) - gain.top);
  return next;
}

/**
 * 직접 입력: "이 배너에서 지금까지 n번 뽑았다"(최고 등급 없이 횟수만 맞추기, 배너 누적).
 * 지금 누적보다 크면 차이만큼 뽑기를 더한다. 더하면 천장에 닿는 경우는 받지 않는다(그 안에 최고 등급이 나왔을 것).
 */
export function recordPullsTo(
  records: Records,
  game: GameId,
  groupId: string,
  n: number,
  now: Date = new Date(),
): { records: Records; mode: "added" | "too-far" | "invalid" } {
  const group = findGroup(game, groupId);
  const unit = group.odds?.unit ?? 1;
  n = Math.ceil(n / unit) * unit;
  const st = groupStatus(records.games[game], game, groupId);
  if (!Number.isInteger(n) || n <= st.bannerPulls || n > 2000) return { records, mode: "invalid" };
  const add = n - st.bannerPulls;
  if (group.hardPity !== null && st.pity + add >= group.hardPity) return { records, mode: "too-far" };
  const next = recordSession(records, game, groupId, add, new Map(), now);
  next.games[game].currency = { ...records.games[game].currency }; // 지난 뽑기 → 재화는 그대로
  const last = next.undo[next.undo.length - 1];
  if (last) last.label = `${GAMES[game].shortName} 배너 ${n}번째까지 횟수 맞추기`;
  return { records: next, mode: "added" };
}

/** 한 종류의 기록을 전부 지우고 시작 상태(기준값)·교환 기록도 비운다. 뽑기는 되돌리기로 복구할 수 있다(시작 상태는 복구 안 됨) */
export function resetGroup(records: Records, game: GameId, groupId: string): Records {
  const next = structuredClone(records);
  const rec = next.games[game];
  const gone = rec.pulls.filter((p) => p.group === groupId);
  rec.pulls = rec.pulls.filter((p) => p.group !== groupId);
  rec.baseline[groupId] = emptyBaseline(); // 지우지 않고 빈 값으로(다른 기기와 합칠 때 예전 값이 되살아나지 않게)
  rec.exchanges = (rec.exchanges ?? []).filter((e) => e.group !== groupId);
  pushUndo(next, { game, label: `${GAMES[game].shortName} ${findGroup(game, groupId).name} 기록 전부 지우기`, addedPullIds: [], replacedPulls: gone, prevCurrency: { ...rec.currency } });
  return next;
}

/**
 * 배너 하나의 기록만 지운다(사용자 2026-11-28: "해당 배너 한정 기록 초기화"). 같은 종류의 다른 배너 기록과 천장 시작 스택은 그대로,
 * 그 배너의 누적 횟수 시작값(픽업 확정 120회 등)과 그 배너의 교환·무료 기록은 비운다. 뽑기는 되돌리기로 복구할 수 있다.
 */
export function resetBanner(records: Records, game: GameId, groupId: string, bannerId: string): Records {
  const next = structuredClone(records);
  const rec = next.games[game];
  const gone = rec.pulls.filter((p) => p.group === groupId && p.banner === bannerId);
  const base = rec.baseline[groupId];
  const baseOnBanner = !!base && base.banner === bannerId && (base.bannerPulls !== 0 || base.bannerFeaturedGot);
  const ex = (rec.exchanges ?? []).filter((e) => e.group === groupId && e.banner === bannerId);
  if (!gone.length && !baseOnBanner && !ex.length) return records;
  rec.pulls = rec.pulls.filter((p) => !(p.group === groupId && p.banner === bannerId));
  if (base && baseOnBanner) rec.baseline[groupId] = { ...base, bannerPulls: 0, bannerFeaturedGot: false };
  rec.exchanges = (rec.exchanges ?? []).filter((e) => !(e.group === groupId && e.banner === bannerId));
  rec.updatedAt = new Date().toISOString();
  pushUndo(next, { game, label: `${GAMES[game].shortName} ${findGroup(game, groupId).name} 배너 기록 지우기 (${gone.length}회)`, addedPullIds: [], replacedPulls: gone, prevCurrency: { ...rec.currency } });
  return next;
}

/** 두 상태의 차이를 되돌리기 한 번으로 묶는다 (중간에 쌓인 되돌리기는 버린다) */
function squashUndo(orig: Records, out: Records, game: GameId, label: string): Records {
  const before = new Map(orig.games[game].pulls.map((p) => [p.id, p]));
  const after = new Map(out.games[game].pulls.map((p) => [p.id, p]));
  const next = structuredClone(out);
  next.undo = structuredClone(orig.undo);
  pushUndo(next, {
    game,
    label,
    addedPullIds: [...after.keys()].filter((id) => !before.has(id)),
    replacedPulls: structuredClone([...before.values()].filter((p) => !after.has(p.id) || JSON.stringify(after.get(p.id)) !== JSON.stringify(p))),
    prevCurrency: { ...orig.games[game].currency },
  });
  return next;
}

/**
 * 직접 입력으로 "n번째에 최고 등급"을 넣으며 함께 만든 뽑기 묶음인지: 직접 입력이고, 최고 등급이 그 묶음의 마지막 자리이며,
 * 그 종류에서 가장 최근 묶음이다. 이런 묶음은 고치거나 지울 때 통째로 다시 만든다(뒤에 남는 빈 뽑기가 생기지 않게).
 */
function isLastTopEntry(rec: GameRecord, p: Pull): boolean {
  if (p.source !== "manual") return false;
  const group = rec.pulls.filter((x) => x.group === p.group).sort(byTime);
  const session = group.filter((x) => x.sessionId === p.sessionId);
  return group.at(-1)?.sessionId === p.sessionId && session.every((x) => x.indexInSession <= p.indexInSession) && session.filter((x) => x.top).length === 1;
}

/** 최고 등급을 보통 뽑기로 되돌린다 (자리는 그대로 — 뒤의 기록 번째가 바뀌지 않게) */
function unmark(rec: GameRecord, id: string): void {
  const p = rec.pulls.find((x) => x.id === id);
  if (!p) return;
  p.top = false;
  p.name = null;
  p.featured = null;
  if (p.rarity != null) p.rarity = null;
}

/**
 * 최고 등급 기록 고치기 (사용자 2026-11-27: 잘못 넣은 것 하나 때문에 다 지우고 다시 넣지 않게).
 * 이름·픽업 여부는 언제나, 몇 번째(n, 배너 누적)는 지금 배너의 기록만 바꾼다. 다른 기록의 번째는 그대로 둔다.
 */
export function editTop(
  records: Records,
  game: GameId,
  pullId: string,
  change: { name: string | null; featured: boolean | null; n?: number },
  now: Date = new Date(),
): { records: Records; mode: "ok" | "taken" | "before" | "too-far" | "invalid" } {
  const rec = records.games[game];
  const p = rec.pulls.find((x) => x.id === pullId);
  if (!p || !p.top) return { records, mode: "invalid" };
  const label = `${GAMES[game].shortName} ${change.name ?? p.name ?? GAMES[game].topLabel} 기록 고침`;
  const oldN = topHistory(rec, p.group).find((h) => h.pull.id === pullId)?.at;
  const moving = change.n !== undefined && change.n !== oldN;
  if (!moving) {
    const next = structuredClone(records);
    const q = next.games[game].pulls.find((x) => x.id === pullId)!;
    q.name = change.name;
    q.featured = change.featured;
    return { records: squashUndo(records, next, game, label), mode: "ok" };
  }
  if (p.banner !== groupStatus(rec, game, p.group).banner) return { records, mode: "invalid" };
  // 옮길 자리에 다른 최고 등급이 이미 있으면 막는다
  const unit = findGroup(game, p.group).odds?.unit ?? 1;
  const n = Math.ceil(change.n! / unit) * unit;
  if (topHistory(rec, p.group).some((h) => h.pull.id !== pullId && h.pull.banner === p.banner && h.at === n)) return { records, mode: "taken" };
  let work = structuredClone(records);
  const wrec = work.games[game];
  if (isLastTopEntry(rec, p)) wrec.pulls = wrec.pulls.filter((x) => x.sessionId !== p.sessionId);
  else unmark(wrec, pullId);
  const out = recordTopAt(work, game, p.group, n, { name: change.name, featured: change.featured }, now);
  if (out.mode !== "added" && out.mode !== "marked") return { records, mode: out.mode };
  work = out.records;
  work.games[game].currency = { ...rec.currency };
  return { records: repairBaselines(squashUndo(records, work, game, label)), mode: "ok" };
}

/** 최고 등급 기록 하나 지우기: 마지막에 직접 넣은 것이면 함께 넣은 뽑기까지, 아니면 그 자리만 보통 뽑기로 (뒤 기록은 그대로) */
export function removeTop(records: Records, game: GameId, pullId: string): Records {
  const rec = records.games[game];
  const p = rec.pulls.find((x) => x.id === pullId);
  if (!p || !p.top) return records;
  const next = structuredClone(records);
  const nrec = next.games[game];
  if (isLastTopEntry(rec, p)) nrec.pulls = nrec.pulls.filter((x) => x.sessionId !== p.sessionId);
  else unmark(nrec, pullId);
  return repairBaselines(squashUndo(records, next, game, `${GAMES[game].shortName} ${p.name ?? GAMES[game].topLabel} 기록 지우기`));
}
