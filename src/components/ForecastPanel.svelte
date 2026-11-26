<script lang="ts">
  // 재화 예측 (DESIGN.md §6-2, 사용자 2026-11-26): 목표일까지 일일·주간 과제 + 켠 월정액으로 모이는 재화.
  // 목표일은 자유(게임 안 월정액 최대 기간과 상관없음). 지급량 출처는 화면에 쓰지 않고 문서에만 둔다.
  import { GAMES } from "../lib/games";
  import { dayStart, emptyPlan, forecast, passOn, PASSES, ROUTINES, today, type IncomePlan } from "../lib/income";
  import type { GameId, GameRecord } from "../lib/types";

  let { game, record, groupId, bannerEnd = null, onPlan }: {
    game: GameId;
    record: GameRecord;
    groupId: string;
    /** 지금 배너가 끝나는 시각(ISO). 목표일 기본값 */
    bannerEnd?: string | null;
    onPlan: (plan: IncomePlan) => void;
  } = $props();

  let open = $state(false);
  const plan = $derived<IncomePlan>({ ...emptyPlan(), ...(record.income ?? {}) });
  const ymd = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const md = (s: string) => s.slice(5).replace("-", "/");
  const targetStr = $derived(plan.target ?? (bannerEnd ? ymd(Date.parse(bannerEnd)) : ymd(today() + 30 * 864e5)));
  const result = $derived(forecast(record, game, groupId, plan, dayStart(targetStr)));
  const label = (key: string) => GAMES[game].currencies.find((c) => c.key === key)?.label ?? key;
  const gainsText = (g: Record<string, number>) => Object.entries(g).map(([k, v]) => `${label(k)} +${v.toLocaleString()}`).join(" · ");
  const ok = (need: number | null) => need !== null && result.laterPulls >= need;
  const need = (n: number) => (result.laterPulls >= n ? "✓" : `${n - result.laterPulls} 부족`);
  const routineOn = $derived(plan.routine !== false);
  const hasRoutine = $derived(ROUTINES[game].length > 0);
  /** 하루에 받는 양을 한 줄로 (스위치 옆 설명) */
  const perDay = (g: Record<string, number>) => Object.entries(g).map(([k, v]) => `${label(k)} ${v}`).join(", ");

  function set(patch: Partial<IncomePlan>) {
    onPlan({ ...plan, ...patch });
  }
  function togglePass(id: string) {
    // 켜고 끈 상태를 모든 월정액에 대해 적어 둔다(예전 "끝나는 날" 형식은 이걸로 대체)
    const passes: Record<string, boolean> = {};
    for (const p of PASSES[game]) passes[p.id] = passOn(plan, p.id);
    passes[id] = !passes[id];
    set({ passes, until: undefined });
  }
</script>

<section class="forecast card">
  <button class="head" onclick={() => (open = !open)} aria-expanded={open}>
    <strong>예측</strong>
    <span class="sum">{md(targetStr)}까지 <b>{result.nowPulls} → {result.laterPulls}회</b></span>
    <span class="arrow">{open ? "▲" : "▼"}</span>
  </button>

  {#if open}
    <div class="body">
      <label class="row">
        <span class="name">목표일</span>
        <input type="date" value={targetStr} min={ymd(today())} onchange={(e) => set({ target: (e.currentTarget as HTMLInputElement).value || null })} />
      </label>

      <div class="toggles">
        {#if hasRoutine}
          <button class="tg" class:on={routineOn} onclick={() => set({ routine: !routineOn })} aria-pressed={routineOn}>
            <span class="sw"></span>
            <span class="tname">일일·주간 과제</span>
          </button>
        {/if}
        {#each PASSES[game] as p (p.id)}
          {@const on = passOn(plan, p.id)}
          <button class="tg" class:on onclick={() => togglePass(p.id)} aria-pressed={on}>
            <span class="sw"></span>
            <span class="tname">{p.label}</span>
            <span class="tsub">매일 {perDay(p.daily)}</span>
          </button>
        {/each}
      </div>

      {#if result.lines.length}
        <div class="lines">
          {#each result.lines as l (l.label)}
            <div class="line"><span>{l.label} <small>{l.detail}</small></span><span>{gainsText(l.gains)}</span></div>
          {/each}
        </div>
      {:else}
        <p class="muted none">켠 수입이 없습니다. 위에서 일일 과제나 월정액을 켜세요.</p>
      {/if}

      <div class="stats">
        {#if result.toTop !== null}
          <span class:good={ok(result.toTop)} class:bad={!ok(result.toTop)}>천장 {result.toTop}회 {need(result.toTop)}</span>
        {/if}
        {#if result.bonus}<span>{result.bonus.remaining}회 더 뽑으면 {result.bonus.label}</span>{/if}
        {#if result.toFeatured !== null && result.toFeatured !== result.toTop}
          <span class:good={ok(result.toFeatured)} class:bad={!ok(result.toFeatured)}>픽업 확정 {result.toFeatured}회 {need(result.toFeatured)}</span>
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
  .forecast { display: flex; flex-direction: column; gap: 6px; }
  .head { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: 0; padding: 0; color: inherit; text-align: left; cursor: pointer; }
  .sum { flex: 1; font-size: 12px; color: var(--muted); text-align: right; }
  .sum b { color: var(--text); }
  .arrow { font-size: 10px; color: var(--muted); }
  .body { display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
  .row { display: flex; align-items: center; gap: 6px; }
  .name { min-width: 4em; color: var(--muted); }
  .row input { flex: 1; min-width: 0; }
  .toggles { display: flex; flex-direction: column; gap: 4px; }
  .tg { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 6px 8px; }
  .sw { flex: none; width: 30px; height: 17px; border-radius: 9px; background: var(--line); position: relative; transition: background 0.15s; }
  .sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: var(--muted); transition: transform 0.15s; }
  .tg.on .sw { background: var(--good); }
  .tg.on .sw::after { transform: translateX(13px); background: #fff; }
  .tname { font-weight: 600; }
  .tsub { margin-left: auto; color: var(--muted); font-size: 11px; }
  .lines { display: flex; flex-direction: column; gap: 3px; }
  .line { display: flex; justify-content: space-between; gap: 8px; }
  .line small { color: var(--muted); }
  .none { margin: 0; }
  .stats { display: flex; flex-wrap: wrap; gap: 4px 10px; font-weight: 600; }
  .good { color: var(--good); }
  .bad { color: #ff8a7a; }
</style>
