// 림버스 뽑기 세기 (정리 2026-11-27: screen.svelte.ts가 500줄을 넘어 떼어 냄).
// 1) 추출 확인 창("광기 1300을(를) 소비하여 …")이 뜰 때마다 바로 기록 — 결과 화면의 "재추출"도
// 2) 추출 화면의 "이상 N/200"이 오른 만큼으로 맞춰 봄 — 확인 창을 놓친 뽑기는 채우고, 취소한 것은 지움(티켓도 되돌림)
import { app } from "../store.svelte";
import { groupBanners } from "../banners";
import { groupStatus, recordExchange, recordResult, syncBannerPulls } from "../ledger";
import { counterStep, emptyCounterState, limbusBannerOnScreen, parseLimbusConfirm, type CounterState, type LimbusConfirm } from "../limbus-counter";
import type { ScreenReading } from "../recognize";
import { readLocal, writeLocal } from "./local";
import type { AutoEntry } from "./screen.svelte";

const LIMBUS_COUNTER_KEY = "tg-limbus-counter";
const LIMBUS_DIALOG_KEY = "tg-limbus-dialog";

/** 확인 창으로 기록한 한 번: 뽑기 id들과 쓴 티켓(취소였으면 되돌린다) */
interface DialogPull { ids: string[]; key: string | null; amount: number }

export class LimbusPulls {
  /** 확인 창으로 기록한 뽑기(배너 id → 뽑기 id). 다음에 이상 숫자를 볼 때 맞춰 보고 비운다 */
  private dialogPulls: Record<string, DialogPull[]> = LimbusPulls.loadDialogPulls();
  /** 확인 창이 떠 있는 동안 한 번만 센다 */
  private dialogOpen = false;
  private limbusCounter: CounterState = { ...emptyCounterState(), last: readLocal<Record<string, number>>(LIMBUS_COUNTER_KEY, {}) };

  constructor(private addAuto: (e: AutoEntry) => void) {}

  static loadDialogPulls(): Record<string, DialogPull[]> {
    const raw = readLocal<Record<string, unknown[]>>(LIMBUS_DIALOG_KEY, {});
    // 예전 저장 형식(뽑기 id 목록)은 버린다 — 다음 이상 숫자에서 다시 맞춰진다
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, (v ?? []).filter((x): x is DialogPull => typeof x === "object" && !!x && Array.isArray((x as DialogPull).ids))]));
  }

  /** 화면 글자 한 장: 확인 창이면 (떠 있는 동안 한 번만) 기록 */
  onLines = (lines: { t: string; x: number; y: number }[]) => {
    const confirm = parseLimbusConfirm(lines);
    if (confirm && !this.dialogOpen) this.onConfirm(confirm);
    // 창이 떠 있는 동안 읽은 이상 숫자는 쓰지 않는다(창 뒤의 아직 안 바뀐 숫자) → 닫힌 뒤 새로 두 번 읽어 확정
    if (confirm) this.limbusCounter = { ...this.limbusCounter, pending: null };
    this.dialogOpen = !!confirm;
  };

  /** 림버스 확인 창 → 그 횟수만큼 기록. 창의 배너 이름이 지금 픽업 배너와 맞을 때만(취소했으면 다음 이상 숫자에서 지운다) */
  private onConfirm(c: LimbusConfirm) {
    const gid = "limbus-extraction";
    const current = app.currentBanner("limbus", gid);
    if (!current) return;
    const t = c.target.replace(/\s+/g, "");
    const mine = current.featured.some((f) => {
      const ko = (f.ko ?? "").replace(/\s+/g, "");
      const sinner = (f.ko ?? "").split(" ").at(-1) ?? "";
      return (t.length >= 2 && ko.includes(t)) || (sinner.length >= 2 && t.includes(sinner));
    });
    if (!mine) return;
    const before = app.records.games.limbus.currency;
    const next = recordResult(app.records, "limbus", gid, c.pulls, [], new Date());
    // 광기는 화면에서 읽은 값으로 맞춰지므로 그대로, 티켓은 쓴 만큼 뺀다(직접 입력한 티켓 수가 맞게)
    const cur = { ...before };
    const key = /10회/.test(c.item) ? "tenTicket" : /티켓/.test(c.item) ? "ticket" : null;
    if (key) cur[key] = Math.max(0, (cur[key] ?? 0) - c.amount);
    next.games.limbus.currency = cur;
    app.update(next);
    const ids = next.undo.at(-1)?.addedPullIds ?? [];
    this.dialogPulls = { ...this.dialogPulls, [current.id]: [...(this.dialogPulls[current.id] ?? []), { ids, key, amount: c.amount }] };
    writeLocal(LIMBUS_DIALOG_KEY, this.dialogPulls);
    const label = `림버스 픽업 추출 ${c.pulls}회`;
    this.addAuto({ id: `lbc-${Date.now()}`, game: "limbus", label, pullIds: ids, uncertain: false, time: Date.now() });
    app.notify(`${label} 자동 기록 (${c.item} ${c.amount})`);
  }

  /**
   * 추출 화면의 "이상 N/200"이 오른 만큼 뽑기로 기록한다(사용자 2026-11-27 — 티켓 뽑기도 세고, 다른 배너와 섞이지 않게).
   * 화면의 배너(종료일·수감자)가 앱의 지금 픽업 배너와 같을 때만. 처음 본 배너는 기준값만 잡고, 앱 누적 횟수가 모자라면 맞춘다.
   * 확인 창으로 이미 기록한 것과 맞춰 본다(취소는 지움, 놓친 것은 채움).
   */
  onReading = (r: ScreenReading) => {
    const gid = "limbus-extraction";
    const current = app.currentBanner("limbus", gid);
    const onScreen = limbusBannerOnScreen(r, groupBanners(app.pack, "limbus", gid));
    const banner = onScreen && current && onScreen.id === current.id ? current.id : null;
    if (this.dialogOpen) return;
    const step = counterStep(this.limbusCounter, banner, r.counter ?? null);
    this.limbusCounter = step.state;
    const confirmed = step.first !== null || step.from !== null;
    if (!confirmed) return;
    // 숫자가 그대로여도 확인 창 기록이 남아 있으면 맞춰 본다(취소했으면 지움)
    if (!step.add && !step.exchanged && step.first === null && !(banner && this.dialogPulls[banner]?.length)) return;
    writeLocal(LIMBUS_COUNTER_KEY, step.state.last);
    // 확인 창으로 이미 기록한 것(그 뒤 이상이 확정될 때마다 맞춰 보고 비운다)
    const events = banner ? this.dialogPulls[banner] ?? [] : [];
    const viaDialog = events.flatMap((e) => e.ids);
    if (banner && viaDialog.length) {
      const { [banner]: _done, ...rest } = this.dialogPulls;
      this.dialogPulls = rest;
      writeLocal(LIMBUS_DIALOG_KEY, rest);
    }
    if (step.first !== null) {
      // 앱이 모르던 뽑기가 있으면 누적 횟수만 맞춘다(이상 = 뽑은 수 − 200 × 교환 수)
      const rec = app.records.games.limbus;
      const swaps = (rec.exchanges ?? []).filter((e) => e.group === gid && e.banner === current!.id && e.kind !== "free").length;
      const target = step.first + 200 * swaps;
      if (groupStatus(rec, "limbus", gid).bannerPulls < target) app.update(syncBannerPulls(app.records, "limbus", gid, target));
      return;
    }
    const notes: string[] = [];
    // 줄었는데 그 사이 뽑기가 20회를 넘으면 숫자를 잘못 읽었을 수 있다(예: 40 → "4") → 기록하지 않고 알리기만
    if (step.exchanged && step.add > 20) {
      app.notify(`림버스 이상이 ${step.from}→${r.counter}로 줄었습니다. 교환했다면 홈의 "＋ 000 기록 → 교환"으로, 뽑은 횟수는 "횟수만"으로 맞춰 주세요`);
      return;
    }
    // 이상이 늘어난 수 − 확인 창으로 기록한 수: 남으면 창을 못 읽은 것(채움), 모자라면 취소한 것(지움)
    const extra = step.add - viaDialog.length;
    if (extra < 0) {
      const drop = new Set(viaDialog.slice(extra));
      const next = structuredClone(app.records);
      next.games.limbus.pulls = next.games.limbus.pulls.filter((p) => !drop.has(p.id));
      // 통째로 취소된 확인 창에서 뺀 티켓은 되돌린다
      for (const e of events) {
        if (e.key && e.ids.length && e.ids.every((id) => drop.has(id))) {
          next.games.limbus.currency[e.key] = (next.games.limbus.currency[e.key] ?? 0) + e.amount;
        }
      }
      app.update(next);
      notes.push(`확인 창에서 취소한 ${-extra}회를 지웠습니다 (이상 ${step.from}→${r.counter})`);
    }
    if (extra > 0) {
      const next = recordResult(app.records, "limbus", gid, extra, [], new Date());
      // 광기·티켓 중 무엇으로 뽑았는지 모르므로 재화는 깎지 않는다(광기는 화면에서 읽은 값으로 따로 맞춰진다)
      next.games.limbus.currency = { ...app.records.games.limbus.currency };
      app.update(next);
      const label = `림버스 픽업 추출 ${extra}회`;
      // 20회 넘게 한꺼번에 늘었으면 "확인할 것"에서 취소할 수 있게 표시
      this.addAuto({ id: `lb-${Date.now()}`, game: "limbus", label, pullIds: next.undo.at(-1)?.addedPullIds ?? [], uncertain: extra > 20, time: Date.now() });
      notes.push(`${label} 자동 기록 (이상 ${step.from}→${r.counter}${viaDialog.length ? `, 확인 창으로 ${viaDialog.length}회는 이미 기록` : ""})`);
    }
    if (step.add > 0) {
      // 추출 이력은 최근 20개만 보인다 → 그보다 많이 몰아 뽑으면 앞쪽은 이름·000을 못 채운다(사용자 지적 2026-11-27)
      notes.push(step.add > 20 ? `앞의 ${step.add - 20}회는 추출 이력에 안 남습니다. 000이 나왔다면 직접 기록해 주세요` : "이름은 추출 이력에서 채워집니다");
    }
    if (step.exchanged) {
      // 이상 200개 교환(받은 인격 이름은 화면에서 알 수 없다)
      app.update(recordExchange(app.records, "limbus", gid, null, new Date()));
      notes.push("이상 200개 교환도 기록했습니다(인격 이름은 홈의 교환 기록에서 지우고 다시 넣어 고칠 수 있어요)");
    }
    app.notify(notes.join(". "));
  };


}
