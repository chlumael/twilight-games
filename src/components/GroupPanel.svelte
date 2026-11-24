<script lang="ts">
  import type { GroupStatus } from "../lib/ledger";

  let { status, topLabel, onBanner }: {
    status: GroupStatus;
    topLabel: string;
    onBanner: (name: string) => void;
  } = $props();

  const ratio = $derived(status.hardPity ? Math.min(1, status.pity / status.hardPity) : 0);
  const inSoft = $derived(status.softFrom !== null && status.pity + 1 >= status.softFrom);
</script>

<section class="group">
  <div class="pity">
    <span class="num">{status.pity}</span>
    {#if status.hardPity}<span class="muted">/ {status.hardPity}</span>{/if}
    <span class="muted label">{topLabel} 이후 뽑기</span>
    {#if inSoft}<span class="warn tag">확률 상승 구간</span>{/if}
  </div>
  {#if status.hardPity}
    <div class="bar"><div class="fill" class:soft={inSoft} style:width="{ratio * 100}%"></div></div>
  {/if}

  <div class="facts">
    {#if status.guaranteed !== null}
      <span class:good={status.guaranteed}>
        {status.guaranteed ? "다음 확정" : "다음 50:50"}{status.guaranteeUncertain ? " (픽업 여부 미입력)" : ""}
      </span>
    {/if}
    {#each status.counters as c}
      <span class:good={c.done}>{c.label} {c.done ? "완료" : `${c.remaining}회 남음`}</span>
    {/each}
  </div>

  <label class="banner">
    배너
    <input
      value={status.banner}
      placeholder="배너 이름 (천장 분리 기준)"
      onchange={(e) => onBanner((e.currentTarget as HTMLInputElement).value.trim())}
    />
    {#if status.counters.length}<span class="muted">이 배너 {status.bannerPulls}회</span>{/if}
  </label>

  {#if status.lastTop}
    <div class="muted last">
      마지막 {topLabel}: <span class="top">{status.lastTop.name ?? "이름 미입력"}</span>
      {status.lastTop.featured === true ? "· 픽업" : status.lastTop.featured === false ? "· 픽뚫" : ""}
    </div>
  {/if}
</section>

<style>
  .group { display: flex; flex-direction: column; gap: 6px; }
  .pity { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
  .num { font-size: 26px; font-weight: 700; line-height: 1; }
  .label { font-size: 12px; }
  .tag { font-size: 11px; }
  .bar { height: 6px; border-radius: 3px; background: var(--panel); overflow: hidden; }
  .fill { height: 100%; background: var(--accent); }
  .fill.soft { background: var(--warn); }
  .facts { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; }
  .banner { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 6px; }
  .last { font-size: 12px; }
</style>
