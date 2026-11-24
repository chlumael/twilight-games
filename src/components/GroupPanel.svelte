<script lang="ts">
  import type { GroupStatus, TopHit } from "../lib/ledger";
  import type { Pull } from "../lib/types";
  import PityRing from "./PityRing.svelte";
  import PullStrip from "./PullStrip.svelte";

  let { status, topLabel, recent, hits, onBanner }: {
    status: GroupStatus;
    topLabel: string;
    recent: Pull[];
    hits: TopHit[];
    onBanner: (name: string) => void;
  } = $props();

  const inSoft = $derived(status.softFrom !== null && status.pity + 1 >= status.softFrom);
  const toSoft = $derived(status.softFrom !== null ? Math.max(0, status.softFrom - 1 - status.pity) : null);
  const lastHits = $derived(hits.slice(-4).reverse());
</script>

<section class="hero">
  <PityRing pity={status.pity} hard={status.hardPity} soft={status.softFrom} size={100} />
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

{#if status.counters.length}
  <section class="counters">
    {#each status.counters as c}
      {@const done = c.done}
      <div class="counter">
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
  .side { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; }
  .caption { font-size: 12px; color: var(--muted); }
  .chip {
    font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px;
    background: rgba(255, 255, 255, 0.08); border: 1px solid var(--line);
  }
  .chip.on { color: #10140f; background: var(--good); border-color: transparent; }
  .chip.hot { color: #fff; background: rgba(255, 110, 90, 0.85); border-color: transparent; }
  .hint { font-size: 11px; color: var(--muted); }

  .counters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .counter { padding: 7px 8px; border-radius: 8px; background: var(--panel); border: 1px solid var(--line); }
  .ctop { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 5px; }
  .ok { color: var(--good); }
  .mini { height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.08); overflow: hidden; }
  .mini div { height: 100%; background: var(--a2); }

  .history { display: flex; flex-direction: column; gap: 5px; }
  .htitle { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); }
  .legend { display: inline-flex; align-items: center; gap: 4px; }
  .dot { width: 8px; height: 8px; border-radius: 2px; background: var(--top); box-shadow: 0 0 5px var(--glow); display: inline-block; }

  .banner { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }

  .hits { display: flex; flex-direction: column; gap: 4px; }
  .hit {
    display: grid; grid-template-columns: 46px 1fr auto; align-items: center; gap: 8px;
    padding: 5px 8px; border-radius: 8px; background: linear-gradient(90deg, rgba(255, 255, 255, 0.07), transparent);
    border-left: 3px solid var(--top);
  }
  .hit.lost { border-left-style: dashed; }
  .count { font-size: 18px; font-weight: 800; color: var(--top); font-variant-numeric: tabular-nums; }
  .count small { font-size: 10px; font-weight: 500; margin-left: 1px; color: var(--muted); }
  .name { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(255, 255, 255, 0.1); color: var(--muted); }
  .badge.win { background: var(--top); color: #1a1408; font-weight: 700; }
</style>
