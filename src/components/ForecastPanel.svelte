<script lang="ts">
  // 재화 예측 (DESIGN.md §6-2). 지급량·출처 설명은 화면에 쓰지 않고 문서에만 둔다(화면 정리, 사용자 2026-11-26).
  import { GAMES } from "../lib/games";
  import { dayStart, emptyPlan, forecast, PASSES, today, type IncomePlan } from "../lib/income";
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
  const gainText = $derived(Object.entries(result.gains).map(([k, v]) => `${label(k)} +${v.toLocaleString()}`).join(" · "));
  const ok = (need: number | null) => need !== null && result.laterPulls >= need;
  const need = (n: number) => (result.laterPulls >= n ? "✓" : `${n - result.laterPulls} 부족`);

  function set(patch: Partial<IncomePlan>) {
    onPlan({ ...plan, ...patch });
  }
  function setUntil(id: string, v: string) {
    const until = { ...plan.until };
    if (v) until[id] = v; else delete until[id];
    set({ until });
  }
  /** 월정액 30일 더하기 (최대 일수까지) */
  function extend(id: string, days: number, maxDays: number | null) {
    const base = Math.max(today(), plan.until[id] ? dayStart(plan.until[id]) : today());
    let end = base + days * 864e5;
    if (maxDays) end = Math.min(end, today() + maxDays * 864e5);
    setUntil(id, ymd(end));
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
      <div class="stats">
        {#if gainText}<span class="gain">{gainText}</span>{/if}
        {#if result.toTop !== null}
          <span class:good={ok(result.toTop)} class:bad={!ok(result.toTop)}>천장 {result.toTop}회 {need(result.toTop)}</span>
        {/if}
        {#if result.bonus}<span>{result.bonus.remaining}회 더 뽑으면 무료 {result.bonus.pulls}회</span>{/if}
        {#if result.toFeatured !== null && result.toFeatured !== result.toTop}
          <span class:good={ok(result.toFeatured)} class:bad={!ok(result.toFeatured)}>픽업 확정 {result.toFeatured}회 {need(result.toFeatured)}</span>
        {/if}
      </div>

      <label class="row">
        <span class="name">목표일</span>
        <input type="date" value={targetStr} onchange={(e) => set({ target: (e.currentTarget as HTMLInputElement).value || null })} />
      </label>
      {#each PASSES[game] as p (p.id)}
        <div class="row">
          <span class="name">{p.label}</span>
          <input type="date" value={plan.until[p.id] ?? ""} aria-label="{p.label} 끝나는 날"
            onchange={(e) => setUntil(p.id, (e.currentTarget as HTMLInputElement).value)} />
          <button class="small" onclick={() => extend(p.id, p.days, p.maxDays)}>+{p.days}일</button>
        </div>
      {/each}
      {#each GAMES[game].currencies.filter((c) => !c.manualOnly).slice(0, 1) as c (c.key)}
        <label class="row">
          <span class="name">하루 {c.label}</span>
          <input type="number" min="0" placeholder="0" value={plan.extraDaily[c.key] || ""}
            onchange={(e) => set({ extraDaily: { ...plan.extraDaily, [c.key]: Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0) } })} />
        </label>
      {/each}
    </div>
  {/if}
</section>

<style>
  .forecast { display: flex; flex-direction: column; gap: 6px; }
  .head { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: 0; padding: 0; color: inherit; text-align: left; cursor: pointer; }
  .sum { flex: 1; font-size: 12px; color: var(--muted); text-align: right; }
  .sum b { color: var(--text); }
  .arrow { font-size: 10px; color: var(--muted); }
  .body { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
  .stats { display: flex; flex-wrap: wrap; gap: 4px 10px; font-weight: 600; }
  .gain { color: var(--muted); font-weight: 400; flex-basis: 100%; }
  .good { color: var(--good); }
  .bad { color: #ff8a7a; }
  .row { display: flex; align-items: center; gap: 6px; }
  .name { min-width: 6.5em; color: var(--muted); }
  .row input { flex: 1; min-width: 0; }
  .small { font-size: 11px; padding: 2px 6px; }
</style>
