// 홈 화면에서 하는 기록 조작 (정리 2026-11-27: App.svelte에서 떼어 냄).
// 모두 "지금 보고 있는 게임·종류"(app.game, app.activeGroup)에 대해 하고, 결과를 알림으로 알려 준다.
import * as api from "../api";
import { app } from "../store.svelte";
import { GAMES, findGroup } from "../games";
import { matchFeatured } from "../banners";
import {
  editTop, groupStatus, lastSessionSize, markTopInLastSession, normalizeRecords, recordExchange, recordFreeTop, recordPullsTo,
  recordSession, recordTopAt, removeTop, setCurrency, type TopInfo,
} from "../ledger";
import type { IncomePlan } from "../income";
import type { Baseline, GameRecord } from "../types";

const here = () => {
  const game = app.game;
  const groupId = app.activeGroup(game);
  return { game, groupId, def: GAMES[game], group: findGroup(game, groupId), banner: app.currentBanner(game, groupId) };
};

/** 지금 게임의 기록 하나만 고치는 간단한 변경 */
function patchGame(fn: (g: GameRecord, groupId: string) => void) {
  const { game, groupId } = here();
  const next = structuredClone(app.records);
  fn(next.games[game], groupId);
  app.update(next);
}

export function pull(count: number) {
  const { game, groupId, group } = here();
  app.update(recordSession(app.records, game, groupId, count));
  app.notify(`${group.name} ${count}회 기록`);
}

/** 최고 등급 표시: position = 직전 묶음의 몇 번째(0부터), null = 1회로 새로 기록 */
export function saveTop(position: number | null, info: TopInfo) {
  const { game, groupId, def } = here();
  try {
    app.update(position === null
      ? recordSession(app.records, game, groupId, 1, new Map([[0, info]]))
      : markTopInLastSession(app.records, game, groupId, position, info));
    app.notify(`${def.topLabel} 기록 완료`);
  } catch (e) {
    app.notify(String(e instanceof Error ? e.message : e));
  }
}

/** 단축키 "최고 등급 떴다": 30분 안에 기록한 직전 묶음의 마지막 칸에 표시, 없으면 1회로 기록 */
export function hotkeyTop() {
  const { game, groupId } = here();
  const rec = app.records.games[game];
  const last = rec.pulls.filter((p) => p.group === groupId).sort((a, b) => (a.time < b.time ? -1 : 1)).at(-1);
  const recent = last && Date.now() - Date.parse(last.time) < 30 * 60 * 1000;
  const size = recent ? lastSessionSize(rec, groupId) : 0;
  const session = recent ? rec.pulls.filter((p) => p.sessionId === last!.sessionId) : [];
  saveTop(size > 0 && !session.some((p) => p.top) ? size - 1 : null, { name: null, featured: null });
}

/** 직접 입력 "이 배너에서 n번째에 이름" (배너 누적, 사용자 2026-11-26). 픽업 여부는 배너의 픽업 이름과 같은지로 */
export function saveTopAt(n: number, name: string) {
  const { game, groupId, def, banner } = here();
  const status = groupStatus(app.records.games[game], game, groupId);
  const out = recordTopAt(app.records, game, groupId, n, { name: name || null, featured: name ? matchFeatured(banner, name) : null });
  const what = name || def.topLabel;
  if (out.mode === "added" || out.mode === "marked") {
    app.update(out.records);
    // 무기고처럼 10회씩 뽑는 곳은 37 → 40번째(그 10회 묶음의 끝)로 기록된다
    const at = Math.ceil(n / status.unit) * status.unit;
    app.notify(at === n ? `배너 ${n}번째 ${what} 기록` : `${n} → ${at}번째(10회 묶음 단위)로 ${what} 기록`);
  } else if (out.mode === "too-far") {
    app.notify(`지금 기록(${status.bannerPulls}번째)에서 너무 멉니다. 그 사이에 나온 ${def.topLabel}부터 순서대로 넣어 주세요`);
  } else if (out.mode === "before") {
    app.notify("앱에 기록하기 전 구간입니다. 설정의 시작 상태에서 맞춰 주세요");
  } else app.notify("숫자를 다시 확인해 주세요");
}

/** 최고 등급 기록 고치기 (사용자 2026-11-27) */
export function editTopRecord(id: string, change: { name: string | null; featured: boolean | null; n?: number }) {
  const { game, def } = here();
  const out = editTop(app.records, game, id, change);
  if (out.mode === "ok") { app.update(out.records); app.notify("기록을 고쳤습니다"); }
  else if (out.mode === "taken") app.notify(`그 번째에는 이미 다른 ${def.topLabel} 기록이 있습니다`);
  else if (out.mode === "too-far") app.notify(`앞 기록과 너무 멉니다. 그 사이에 나온 ${def.topLabel}부터 넣어 주세요`);
  else if (out.mode === "before") app.notify("앱에 기록하기 전 구간입니다. 설정의 시작 상태에서 맞춰 주세요");
  else app.notify("숫자를 다시 확인해 주세요");
}

export function removeTopRecord(id: string) {
  app.update(removeTop(app.records, app.game, id));
  app.notify("기록을 지웠습니다 — \"확인할 것\"에서 되돌릴 수 있습니다");
}

/** 무료 뽑기(엔드필드 긴급 모집)로 얻은 최고 등급 — 천장·횟수에 안 들어간다 */
export function freeTop(name: string) {
  const { game, groupId, def, group, banner } = here();
  app.update(recordFreeTop(app.records, game, groupId, { name: name || null, featured: name ? matchFeatured(banner, name) : null }));
  app.notify(`${group.freeLabel} ${name || def.topLabel} 기록 (천장·횟수는 그대로)`);
}

/** 교환으로 얻은 최고 등급 (명일방주 데이터 계약, 림버스 이상) */
export function exchange(name: string, option?: { cost: number; low?: boolean }) {
  const { game, groupId, def } = here();
  app.update(recordExchange(app.records, game, groupId, name || null, new Date(), option));
  app.notify(`${name || (option?.low ? "5성" : def.topLabel)} 교환 기록`);
}

/** 최고 등급 없이 "이 배너에서 n번째까지 뽑았다"만 맞추기 */
export function pullsTo(n: number) {
  const { game, groupId, def } = here();
  const out = recordPullsTo(app.records, game, groupId, n);
  if (out.mode === "added") { app.update(out.records); app.notify(`배너 ${n}번째까지 횟수를 맞췄습니다`); return; }
  const status = groupStatus(app.records.games[game], game, groupId);
  app.notify(out.mode === "too-far" ? `그 사이에 ${def.topLabel}이 나왔을 횟수입니다. ${def.topLabel}부터 넣어 주세요` : `지금 기록(${status.bannerPulls}번째)보다 큰 숫자를 넣어 주세요`);
}

export function editCurrency(key: string, value: string) {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  app.update(setCurrency(app.records, app.game, { [key]: n }));
}

export const setBanner = (id: string) => patchGame((g, gid) => { g.currentBanner[gid] = id; });

/** 원신 무기·묶음 기원에서 고른 무기 (신의 궤도·묶음 궤도) */
export function setChosen(name: string) {
  const { game, groupId } = here();
  const banner = groupStatus(app.records.games[game], game, groupId).banner;
  patchGame((g, gid) => {
    const chosen = { ...(g.chosen ?? {}) };
    if (name) chosen[gid] = { banner, name }; else delete chosen[gid];
    g.chosen = chosen;
  });
}

export const setIncomePlan = (plan: IncomePlan) => patchGame((g) => { g.income = plan; });
export const setBaseline = (gid: string, b: Baseline) => patchGame((g) => { g.baseline[gid] = b; });

export async function exportData() {
  const path = await api.exportBackup(JSON.stringify(app.records, null, 2));
  if (path) app.notify("백업을 저장했습니다");
}

export async function importData() {
  const text = await api.importBackup();
  if (!text) return;
  try {
    const parsed = JSON.parse(text);
    if (parsed?.schemaVersion !== 1) throw new Error("황혼 게임즈 백업 파일이 아닙니다");
    app.update(normalizeRecords(parsed));
    app.notify("백업을 불러왔습니다");
  } catch (e) {
    app.notify(`가져오기 실패: ${e instanceof Error ? e.message : e}`);
  }
}
