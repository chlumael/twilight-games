// 기기 저장·불러오기, 배너 자료·이미지 목록 받기, 배너 일정 따라가기 (정리 2026-11-27: App.svelte에서 떼어 냄).
import * as api from "../api";
import { app } from "../store.svelte";
import { GAMES, GAME_IDS } from "../games";
import { autoBanner, groupBanners, isPack, newerPack, PACK_URL } from "../banners";
import { IMAGES_BASE, isImageIndex, setImageIndex } from "../images.svelte";
import { carryToNextBanner, normalizeRecords, setSeriesOf } from "../ledger";
import { normalizeSettings } from "../settings";
import type { Records } from "../types";

/** 처음 켤 때: 저장해 둔 기록·설정 읽기 */
export async function loadStored(): Promise<void> {
  try {
    const [r, s] = await Promise.all([api.readStore("records"), api.readStore("settings")]);
    app.records = normalizeRecords(r ? JSON.parse(r) : null);
    app.settings = normalizeSettings(s ? JSON.parse(s) : null);
    app.game = app.settings.lastGame;
  } catch (e) {
    app.notify(`불러오기 실패: ${e}`);
  }
  app.loaded = true;
}

/** 다시 읽기: 다른 창(앱 ↔ 게임 위 창)이 그사이 저장했을 수 있다 */
export async function reloadStored(): Promise<void> {
  try {
    const [r, s] = await Promise.all([api.readStore("records"), api.readStore("settings")]);
    if (r) app.records = normalizeRecords(JSON.parse(r));
    if (s) app.settings = normalizeSettings(JSON.parse(s));
  } catch { /* 지금 상태 유지 */ }
}

/** 배너 자료: 앱에 든 것, 저장해 둔 것, 저장소의 최신 것 중 가장 새것. 오프라인이어도 괜찮다 */
export async function refreshPack(): Promise<void> {
  try {
    const cached = await api.readStore("banners");
    const c = cached ? JSON.parse(cached) : null;
    if (isPack(c)) app.pack = newerPack(app.pack, c);
  } catch { /* 깨진 저장본은 무시 */ }
  try {
    const res = await fetch(PACK_URL, { cache: "no-store" });
    const remote = res.ok ? await res.json() : null;
    if (isPack(remote) && newerPack(app.pack, remote) === remote) {
      app.pack = remote;
      await api.writeStore("banners", JSON.stringify(remote));
    }
  } catch { /* 오프라인: 있는 것으로 */ }
}

/** 게임 이미지 목록: 저장해 둔 것을 먼저 쓰고, 새 목록을 받으면 바꾼다 (그림은 보일 때 받는다) */
export async function refreshImages(): Promise<void> {
  try {
    const c = JSON.parse((await api.readStore("images")) ?? "null");
    if (isImageIndex(c)) setImageIndex(c);
  } catch { /* 깨진 저장본은 무시 */ }
  try {
    const res = await fetch(IMAGES_BASE + "index.json", { cache: "no-store" });
    const remote = res.ok ? await res.json() : null;
    if (isImageIndex(remote)) {
      setImageIndex(remote);
      await api.writeStore("images", JSON.stringify(remote));
    }
  } catch { /* 오프라인: 있는 것으로 */ }
}

/**
 * 화면이 처음 만들어질 때 한 번 부른다(안의 $effect가 그 화면에 붙는다).
 * - 기록·설정이 바뀌면 0.3초 뒤 저장
 * - 배너 일정 따라가기: 지금 열린 배너로 바꾸고, 배너가 넘어가면 배너 전용 재화 소멸·다음 배너 보상
 * - 엔드필드 재구축: 같은 시리즈 배너끼리 120 확정·누적 횟수를 이어서 센다
 */
export function useDataEffects(): void {
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const r = app.records;
    const s = app.settings;
    if (!app.loaded) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await api.writeStore("records", JSON.stringify(r));
        await api.writeStore("settings", JSON.stringify(s));
      } catch (e) {
        app.notify(`저장 실패: ${e}`);
      }
    }, 300);
  });

  $effect(() => {
    const series = new Map<string, string>();
    // 시리즈 = 데이터의 series, 없으면 엔드필드 재구축은 배너 이름의 「」 안(공식: 같은 이름 #1, #2…끼리 계승)
    for (const list of Object.values(app.pack?.games ?? {})) for (const b of list) {
      const named = b.group.startsWith("endfield-refactor") ? b.name.match(/「([^」]+)」/)?.[1] : undefined;
      const sr = b.series ?? named;
      if (sr) series.set(b.id, sr);
    }
    setSeriesOf((id) => series.get(id) ?? id);
  });

  $effect(() => {
    const pack = app.pack;
    if (!app.loaded || !pack) return;
    const records = app.records;
    let next: Records | null = null;
    for (const id of GAME_IDS) {
      for (const g of GAMES[id].groups) {
        let cur = (next ?? records).games[id].currentBanner[g.id] ?? "";
        const list = groupBanners(pack, id, g.id);
        // 배너가 다른 종류로 옮겨졌으면(예: 명일방주 콜라보 분리) 이 종류에서는 비운다
        if (cur && !list.some((b) => b.id === cur) && (pack.games[id] ?? []).some((b) => b.id === cur)) {
          next ??= structuredClone(records);
          next.games[id].currentBanner[g.id] = "";
          cur = "";
        }
        const to = autoBanner(list, cur);
        if (!to) continue;
        next ??= structuredClone(records);
        // 더 뒤에 열린 배너로 넘어갈 때만: 배너 전용 재화 소멸, 지난 배너의 "다음 배너 보상" 지급 (엔드필드 정보서)
        const from = list.find((b) => b.id === cur);
        const into = list.find((b) => b.id === to);
        if (from?.start && into?.start && into.start > from.start) {
          const out = carryToNextBanner(next, id, g.id);
          next = out.records;
          if (out.notes.length) app.notify(`${GAMES[id].shortName} 새 배너: ${out.notes.join(", ")}`);
        }
        next.games[id].currentBanner[g.id] = to;
      }
    }
    if (next) app.records = next;
  });
}
