<script lang="ts">
  import type { GroupStatus, TopHit } from "../lib/ledger";
  import type { Pull } from "../lib/types";
  import PityBar from "./PityBar.svelte";
  import PityRing from "./PityRing.svelte";
  import PullStrip from "./PullStrip.svelte";

  let { status, topLabel, recent, hits, gauge, onBanner }: {
    status: GroupStatus;
    gauge: "ring" | "bar";
    topLabel: string;
    recent: Pull[];
    hits: TopHit[];
    onBanner: (name: string) => void;
  } = $props();

  const inSoft = $derived(status.softFrom !== null && status.pity + 1 >= status.softFrom);
  const toSoft = $derived(status.softFrom !== null ? Math.max(0, status.softFrom - 1 - status.pity) : null);
  const lastHits = $derived(hits.slice(-4).reverse());
  // Without hard pity (Limbus) the ring tracks the first banner counter (200 exchange).
  const ringCounter = $derived(status.hardPity === null ? status.counters[0] : undefined);
  const counters = $derived(status.counters.filter((c) => c !== ringCounter));
</script>

<section class="hero" class:wide={gauge === "bar" && status.hardPity}>
  {#if gauge === "bar" && status.hardPity}
    <PityBar value={status.pity} max={status.hardPity} soft={status.softFrom} />
  {:else if ringCounter}
    <PityRing value={ringCounter.at - ringCounter.remaining} max={ringCounter.at} label={String(status.pity)}
      sub={`${ringCounter.label}까지 ${ringCounter.remaining}`} size={100} />
  {:else}
    <PityRing value={status.pity} max={status.hardPity} soft={status.softFrom} sub={status.hardPity ? `/ ${status.hardPity}` : undefined} size={100} />
  {/if}
  <div class="side">
    <span class="caption">{topLabel} 이후 뽑기</span>
    {#if status.guaranteed !== null}
      <span class="chip" class:on={status.guaranteed}>
        {status.guaranteed ? "다음 픽업 확정" : "다음 50:50"}{status.guaranteeUncertain ? " ?" : ""}
      </span>
    {/if}
    {#if inSoft}
      <span class="chip hot">확률 상승 중</span>
    {:else if toSoft !== null}
      <span class="hint">확률 상승까지 {toSoft}회</span>
    {/if}
    {#if status.hardPity}
      <span class="hint">천장까지 {Math.max(0, status.hardPity - status.pity)}회</span>
    {/if}
  </div>
</section>

{#if counters.length}
  <section class="counters">
    {#each counters as c}
      {@const done = c.done}
      <div class="counter card">
        <div class="ctop">
          <span>{c.label}</span>
          <span class:ok={done}>{done ? "완료" : `${c.remaining}회 남음`}</span>
        </div>
        <div class="mini"><div style:width="{done ? 100 : ((c.at - c.remaining) / c.at) * 100}%"></div></div>
      </div>
    {/each}
  </section>
{/if}

<section class="history">
  <div class="htitle"><span>최근 40회</span><span class="legend"><i class="dot"></i>{topLabel}</span></div>
  <PullStrip pulls={recent} />
</section>

<label class="banner">
  <span>배너</span>
  <input
    value={status.banner}
    placeholder="배너 이름 (천장 분리 기준)"
    onchange={(e) => onBanner((e.currentTarget as HTMLInputElement).value.trim())}
  />
  {#if status.counters.length}<span class="hint">{status.bannerPulls}회</span>{/if}
</label>

{#if lastHits.length}
  <section class="hits">
    {#each lastHits as h (h.pull.id)}
      <div class="hit" class:lost={h.pull.featured === false}>
        <span class="count">{h.count}<small>뽑</small></span>
        <span class="name">{h.pull.name ?? `${topLabel} (이름 미입력)`}</span>
        {#if h.pull.featured === true}<span class="badge win">픽업</span>
        {:else if h.pull.featured === false}<span class="badge">픽뚫</span>{/if}
      </div>
    {/each}
  </section>
{/if}

<style>
  .hero { display: flex; align-items: center; gap: 14px; }
  .hero.wide { flex-direction: column; align-items: stretch; gap: 8px; }
  .hero.wide .side { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
  .side { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; }
  .caption { font-size: 12px; color: var(--muted); }
  .chip {
    font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: var(--btn-radius);
    background: var(--panel); border: 1px solid var(--line);
  }
  .chip.on { color: #0e140f; background: var(--good); border-color: transparent; }
  .chip.hot { color: #fff; background: rgba(255, 110, 90, 0.85); border-color: transparent; }
  .hint { font-size: 11px; color: var(--muted); }

  .counters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .counter { padding: 7px 8px; border-radius: var(--radius); background: var(--panel); }
  .ctop { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 5px; }
  .ok { color: var(--good); }
  .mini { height: 4px; background: var(--track); overflow: hidden; }
  .mini div { height: 100%; background: var(--a2); }

  .history { display: flex; flex-direction: column; gap: 5px; }
  .htitle { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); }
  .legend { display: inline-flex; align-items: center; gap: 4px; }
  .dot { width: 8px; height: 8px; border-radius: 2px; background: var(--top); box-shadow: 0 0 5px var(--glow); display: inline-block; }

  .banner { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }

  .hits { display: flex; flex-direction: column; gap: 4px; }
  .hit {
    display: grid; grid-template-columns: 46px 1fr auto; align-items: center; gap: 8px;
    padding: 5px 8px; border-radius: var(--radius); background: linear-gradient(90deg, var(--panel), transparent);
    border-left: 3px solid var(--top);
  }
  .hit.lost { border-left-style: dashed; }
  .count { font-family: var(--num-font); font-size: 19px; font-weight: 700; color: var(--top); font-variant-numeric: tabular-nums; }
  .count small { font-size: 10px; font-weight: 500; margin-left: 1px; color: var(--muted); }
  .name { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { font-size: 10px; padding: 2px 6px; border-radius: var(--btn-radius); background: var(--panel); border: 1px solid var(--line); color: var(--muted); }
  .badge.win { background: var(--top); color: #1a1408; font-weight: 700; }
</style>
