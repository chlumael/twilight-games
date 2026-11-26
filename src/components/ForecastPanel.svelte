<script lang="ts">
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
  const defaultTarget = $derived(bannerEnd ? ymd(Date.parse(bannerEnd)) : ymd(today() + 30 * 864e5));
  const targetStr = $derived(plan.target ?? defaultTarget);
  const result = $derived(forecast(record, game, groupId, plan, dayStart(targetStr)));
  const label = (key: string) => GAMES[game].currencies.find((c) => c.key === key)?.label ?? key;
  const gainText = (g: Record<string, number>) => Object.entries(g).map(([k, v]) => `${label(k)} +${v.toLocaleString()}`).join(", ");

  function set(patch: Partial<IncomePlan>) {
    onPlan({ ...plan, ...patch });
  }
  /** 월정액 30일 더하기 (최대 일수까지) */
  function extend(id: string, days: number, maxDays: number | null) {
    const base = Math.max(today(), plan.until[id] ? dayStart(plan.until[id]) : today());
    let end = base + days * 864e5;
    if (maxDays) end = Math.min(end, today() + maxDays * 864e5);
    set({ until: { ...plan.until, [id]: ymd(end) } });
  }
  function setUntil(id: string, v: string) {
    const until = { ...plan.until };
    if (v) until[id] = v; else delete until[id];
    set({ until });
  }
  const ok = (need: number | null) => need !== null && result.laterPulls >= need;
</script>

<section class="forecast card">
  <button class="head" onclick={() => (open = !open)}>
    <strong>재화 예측</strong>
    <span class="sum">{targetStr}까지 가능 {result.nowPulls} → <b>{result.laterPulls}</b>회</span>
    <span>{open ? "▲" : "▼"}</span>
  </button>

  {#if open}
    <div class="rows">
      <label class="row">목표일
        <input type="date" value={targetStr} onchange={(e) => set({ target: (e.currentTarget as HTMLInputElement).value || null })} />
        {#if plan.target}<button class="small" onclick={() => set({ target: null })}>배너 종료일로</button>{/if}
      </label>

      <div class="result">
        <div class="r"><span>목표일까지 받을 재화</span><b>{Object.keys(result.gains).length ? gainText(result.gains) : "없음"}</b></div>
        {#each result.lines as l (l.label)}
          <div class="r sub"><span>· {l.label}{l.days ? ` (${l.days}일)` : ""}</span><span>{gainText(l.gains)}</span></div>
        {/each}
        <div class="r"><span>가능 횟수</span><b>지금 {result.nowPulls}회 → 목표일 {result.laterPulls}회</b></div>
        {#if result.toTop !== null}
          <div class="r"><span>{GAMES[game].topLabel} 확정(천장)까지</span><b class:good={ok(result.toTop)} class:bad={!ok(result.toTop)}>{result.toTop}회 {ok(result.toTop) ? "— 충분" : `— ${result.toTop - result.laterPulls}회 부족`}</b></div>
        {/if}
        {#if result.toFeatured !== null}
          <div class="r"><span>픽업 확정까지(가장 많이)</span><b class:good={ok(result.toFeatured)} class:bad={!ok(result.toFeatured)}>{result.toFeatured}회 {ok(result.toFeatured) ? "— 충분" : `— ${result.toFeatured - result.laterPulls}회 부족`}</b></div>
        {/if}
      </div>

      <h5>월정액·패스</h5>
      {#each PASSES[game] as p (p.id)}
        <div class="pass">
          {#if p.kind === "daily"}
            <div class="prow">
              <span class="pname">{p.label}</span>
              <input type="date" value={plan.until[p.id] ?? ""} onchange={(e) => setUntil(p.id, (e.currentTarget as HTMLInputElement).value)} />
              <button class="small" onclick={() => extend(p.id, p.days, p.maxDays)}>+{p.days}일</button>
            </div>
            <p class="note">끝나는 날을 넣으면 그날까지 매일 {gainText(p.daily)}. {p.note}</p>
          {:else}
            {@const st = plan.period[p.id] ?? { on: false, remaining: {} }}
            <div class="prow">
              <label class="pname"><input type="checkbox" checked={st.on}
                onchange={(e) => set({ period: { ...plan.period, [p.id]: { ...st, on: (e.currentTarget as HTMLInputElement).checked } } })} /> {p.label}</label>
            </div>
            {#if st.on}
              <div class="prow">
                <span class="muted">아직 안 받은 양</span>
                {#each Object.entries(p.total) as [k, v] (k)}
                  <label class="amt">{label(k)} <input type="number" min="0" value={st.remaining[k] ?? v}
                    onchange={(e) => set({ period: { ...plan.period, [p.id]: { ...st, remaining: { ...st.remaining, [k]: Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0) } } } })} /></label>
                {/each}
              </div>
            {/if}
            <p class="note">{p.note}</p>
          {/if}
        </div>
      {/each}

      <h5>하루 평균 무과금 수입 (직접 입력)</h5>
      <div class="prow">
        {#each GAMES[game].currencies.filter((c) => !c.manualOnly) as c (c.key)}
          <label class="amt">{c.label} <input type="number" min="0" value={plan.extraDaily[c.key] ?? 0}
            onchange={(e) => set({ extraDaily: { ...plan.extraDaily, [c.key]: Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0) } })} /></label>
        {/each}
      </div>
      <p class="note">일일 임무 등 게임이 정해 주지 않는 수입은 직접 넣은 값으로만 계산합니다. 오늘 몫은 이미 받았다고 보고 내일부터 셉니다.</p>
    </div>
  {/if}
</section>

<style>
  .forecast { display: flex; flex-direction: column; gap: 6px; }
  .head { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: 0; padding: 0; color: inherit; text-align: left; cursor: pointer; }
  .sum { flex: 1; font-size: 12px; color: var(--muted); text-align: right; }
  .rows { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
  .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .result { display: flex; flex-direction: column; gap: 3px; padding: 6px 8px; border-radius: var(--radius); background: var(--panel); }
  .r { display: flex; justify-content: space-between; gap: 8px; }
  .r.sub { color: var(--muted); font-size: 11px; }
  .good { color: var(--good); }
  .bad { color: #ff8a7a; }
  h5 { margin: 6px 0 0; font-size: 12px; }
  .pass { display: flex; flex-direction: column; gap: 3px; }
  .prow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .pname { font-weight: 600; min-width: 8em; }
  .amt { display: inline-flex; align-items: center; gap: 4px; }
  .amt input { width: 6em; }
  .note { margin: 0; font-size: 10.5px; color: var(--muted); }
  .small { font-size: 11px; padding: 2px 6px; }
  .muted { color: var(--muted); }
</style>
