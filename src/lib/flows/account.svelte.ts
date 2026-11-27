// 트래커 계정: 로그인·기기끼리 동기화·친구 공유·계정 삭제 (정리 2026-11-27: App.svelte에서 떼어 냄).
// 화면(App.svelte)이 처음 만들어질 때 만들고 autoPush()를 부른다 — 그 안의 $effect가 그 화면에 붙어 돈다.
import { app } from "../store.svelte";
import { GAME_IDS } from "../games";
import { gameFingerprint, gamesToPush, mergeRecords } from "../merge";
import { mergeMine } from "../calendar";
import { normalizeSettings, type Settings } from "../settings";
import { buildSummary } from "../share";
import * as sync from "../sync";

const pushedKey = (uid: string) => `tg-sync-pushed-${uid}`;
const linkedKey = (uid: string) => `tg-sync-linked-${uid}`;
function readJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "") as T; } catch { return fallback; }
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class AccountFlow {
  account = $state<sync.Account | null>(null);
  syncState = $state<"idle" | "syncing" | "ok" | "error">("idle");
  lastSync = $state<string | null>(null);
  shareBusy = $state(false);
  share = $derived(app.settings.share ?? { on: false, nickname: "" });

  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private shareTimer: ReturnType<typeof setTimeout> | undefined;
  private lastShared = "";

  /** 기록이 바뀌면 알아서 올리기 (화면이 만들어질 때 한 번 부른다) */
  autoPush() {
    // 기록이 바뀌면 2초 뒤 계정에 올린다
    $effect(() => {
      void app.records;
      const a = this.account;
      if (!app.loaded || !a) return;
      clearTimeout(this.pushTimer);
      this.pushTimer = setTimeout(() => void this.pushNow(), 2000);
    });
    // 기록이 바뀌면 15초 뒤 친구 탭 요약을 다시 올린다 (공유를 켰을 때만)
    $effect(() => {
      void app.records;
      const on = app.settings.share?.on;
      if (!app.loaded || !this.account || !on) return;
      clearTimeout(this.shareTimer);
      this.shareTimer = setTimeout(() => void this.pushShareNow().catch(() => {}), 15_000);
    });
  }

  /** 이 기기에서 바뀐 게임만 계정에 올린다 */
  pushNow = async () => {
    const a = this.account;
    if (!a) return;
    try {
      await this.pushPending(a.uid);
      this.lastSync = new Date().toISOString();
      this.syncState = "ok";
    } catch {
      this.syncState = "error"; // 다음 변경이나 동기화 때 다시 시도
    }
  };

  /** 로그인 상태 지켜보기 (시작할 때 한 번). 돌려준 함수로 그만 본다 */
  watch = () => sync.watchAccount((a) => {
    const was = this.account?.uid;
    this.account = a;
    if (a && a.uid !== was) void this.syncNow();
  });

  /** 계정 쪽 기록을 받아 합치고, 이 기기 쪽이 더 새것이면 올린다 */
  syncNow = async () => {
    const a = this.account;
    if (!a || this.syncState === "syncing") return;
    this.syncState = "syncing";
    try {
      const remote = await sync.pullAll(a.uid);
      const firstLink = localStorage.getItem(linkedKey(a.uid)) !== "1";
      const merged = mergeRecords(app.records, remote.games, firstLink ? "union" : "newer");
      if (firstLink && remote.settings) app.settings = normalizeSettings(remote.settings);
      else if (remote.settings) {
        // 달력의 내 일정은 기기끼리 합친다(그 밖의 설정은 기기마다 따로)
        const r = normalizeSettings(remote.settings);
        const s = app.settings;
        const removed = [...new Set([...(s.calendarRemoved ?? []), ...(r.calendarRemoved ?? [])])];
        let next: Settings = { ...s, calendar: mergeMine(s.calendar ?? [], r.calendar ?? [], removed), calendarRemoved: removed };
        // 친구 공유 설정은 이 기기에 없을 때만 계정 쪽 것을 가져온다
        if (!next.share && r.share) next = { ...next, share: r.share };
        app.settings = next;
      }
      app.records = merged;
      const pushed: Record<string, string> = {};
      for (const id of GAME_IDS) if (remote.games[id]) pushed[id] = gameFingerprint(remote.games[id]!);
      await this.pushPending(a.uid, pushed);
      await sync.pushSettings(a.uid, app.settings);
      localStorage.setItem(linkedKey(a.uid), "1");
      this.syncState = "ok";
      this.lastSync = new Date().toISOString();
    } catch (e) {
      this.syncState = "error";
      app.notify(`동기화 실패: ${message(e)}`);
    }
  };

  private async pushPending(uid: string, known?: Record<string, string>) {
    const pushed = known ?? readJson<Record<string, string>>(pushedKey(uid), {});
    for (const id of gamesToPush(app.records, pushed)) {
      await sync.pushGame(uid, id, app.records.games[id]);
      pushed[id] = gameFingerprint(app.records.games[id]);
    }
    localStorage.setItem(pushedKey(uid), JSON.stringify(pushed));
  }

  signIn = async () => {
    try {
      this.account = await sync.signIn();
      await this.syncNow();
      app.notify("로그인했습니다. 기록이 계정에 저장됩니다");
    } catch (e) {
      app.notify(`로그인 실패: ${message(e)}`);
    }
  };

  signOut = async () => {
    await sync.signOutAccount();
    this.account = null;
    this.syncState = "idle";
    app.notify("로그아웃했습니다. 이 기기의 기록은 그대로 남습니다");
  };

  /** 계정과 서버 기록 지우기 (최근에 로그인했을 때만 된다) */
  deleteAll = async () => {
    const a = this.account;
    if (!a) return;
    try {
      const out = await sync.deleteAccount(a.uid);
      if (out === "relogin") return app.notify("보안을 위해 로그아웃 → 다시 로그인한 뒤 바로 한 번 더 눌러 주세요");
      localStorage.removeItem(linkedKey(a.uid));
      localStorage.removeItem(pushedKey(a.uid));
      this.account = null;
      this.syncState = "idle";
      app.setSettings({ ...app.settings, share: { on: false, nickname: this.share.nickname } });
      app.notify("계정과 서버 기록을 지웠습니다. 이 기기의 기록은 남아 있습니다");
    } catch (e) {
      app.notify(`계정 삭제 실패: ${message(e)}`);
    }
  };

  // ───── 친구 공유 (DESIGN.md §8.5) ─────

  private setShare(patch: Partial<NonNullable<Settings["share"]>>) {
    app.setSettings({ ...app.settings, share: { ...this.share, ...patch } });
  }

  private async shareTask(label: string, fn: () => Promise<void>) {
    if (!this.account) return;
    this.shareBusy = true;
    try { await fn(); } catch (e) { app.notify(`${label} 실패: ${message(e)}`); } finally { this.shareBusy = false; }
  }

  /** 내 요약을 친구 탭에 올린다 (공유를 켰을 때만). 바뀐 게 없으면 건너뛴다 */
  pushShareNow = async (force = false) => {
    const a = this.account;
    const sh = app.settings.share;
    if (!a || !sh?.on || !sh.nickname.trim()) return;
    const summary = buildSummary(app.records, sh.nickname, app.myGames);
    const key = JSON.stringify({ ...summary, updatedAt: "" });
    if (!force && key === this.lastShared) return;
    await sync.pushShare(a.uid, summary);
    this.lastShared = key;
  };

  /** 친구 탭 "나도 참여하기" */
  join = (name: string) => this.shareTask("참여", async () => {
    this.setShare({ nickname: name.slice(0, 20), on: true });
    await this.pushShareNow(true);
    app.notify("참여했습니다. 내 요약이 친구 탭에 올라갔습니다");
  });

  setNickname = (name: string) => {
    this.setShare({ nickname: name.trim().slice(0, 20) });
    void this.pushShareNow().catch(() => {});
  };

  toggleShare = (on: boolean) => this.shareTask(on ? "공유 켜기" : "공유 끄기", async () => {
    this.setShare({ on });
    if (on) await this.pushShareNow(true);
    else await sync.removeShare(this.account!.uid);
    app.notify(on ? "공유를 켰습니다" : "공유를 껐습니다. 올린 내 요약을 지웠습니다");
  });

  /** 친구 탭 목록 (먼저 내 요약을 최신으로) */
  loadShares = async () => {
    await this.pushShareNow().catch(() => {});
    return sync.pullShares();
  };
}
