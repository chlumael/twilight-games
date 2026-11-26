<script lang="ts">
  import { activeBanners, bannerLabel, daysLeft, itemName, type PackBanner } from "../lib/banners";
  import { hitLabel, type GroupStatus, type TopHit } from "../lib/ledger";
  import type { Exchange, Pull } from "../lib/types";
  import BannerDetail from "./BannerDetail.svelte";
  import PityBar from "./PityBar.svelte";
  import PityRing from "./PityRing.svelte";
  import PullStrip from "./PullStrip.svelte";

  let { status, topLabel, groupLabel = "", recent, hits, gauge, banners = [], onBanner, topNames = [], guessFeatured, onTopAt, chooseOptions = [], chosen = "", onChoose, exchanges = [], onExchange, onRemoveExchange, onPullsTo }: {
    groupLabel?: string;
    status: GroupStatus;
    /** Known banners for this group from the data pack. */
    banners?: PackBanner[];
    gauge: "ring" | "bar";
    topLabel: string;
    recent: Pull[];
    hits: TopHit[];
    onBanner: (name: string) => void;
    /** 직접 입력: 이름 후보(픽업 먼저), 픽업 판정, 저장 — "n뽑에 이름" */
    topNames?: string[];
    guessFeatured?: (name: string) => boolean | null;
    onTopAt?: (n: number, name: string) => void;
    /** 원신 무기·집록: 고를 수 있는 무기(이 배너 픽업)와 지금 고른 무기 */
    chooseOptions?: string[];
    chosen?: string;
    onChoose?: (name: string) => void;
    /** 교환으로 얻은 기록(이 종류·배너). 교환 카운터가 있는 종류에서만 입력을 보여 준다 */
    exchanges?: Exchange[];
    onExchange?: (name: string) => void;
    onRemoveExchange?: (id: string) => void;
    /** 최고 등급 없이 "이 배너에서 n번째까지 뽑았다"만 맞추기 */
    onPullsTo?: (n: number) => void;
  } = $props();
  let countOnly = $state(false);
  const canExchange = $derived(!!onExchange && status.counters.some((c) => /교환/.test(c.label)));
  let byExchange = $state(false);

  /** 한 번에 뽑는 단위(엔드필드 무기 신청 = 10) */
  const step = $derived(status.unit);
  let adding = $state(false);
  let addN = $state<number | null>(null);
  let addName = $state("");
  /** 이름 후보: 적은 글자를 포함하는 것(앞에서부터 맞는 것 먼저). 아무것도 안 적었으면 목록이 짧을 때만 전부 */
  const picks = $derived.by(() => {
    const q = addName.trim().replace(/\s+/g, "");
    if (topNames.length <= 12) return topNames; // 후보가 적으면(배너에 정해진 목록) 늘 전부 보여 준다
    if (!q) return topNames.slice(0, 6);
    const hit = topNames.filter((n) => n.replace(/\s+/g, "").includes(q));
    return [...hit.filter((n) => n.replace(/\s+/g, "").startsWith(q)), ...hit.filter((n) => !n.replace(/\s+/g, "").startsWith(q))].slice(0, 10);
  });
  const addFeatured = $derived(addName.trim() && guessFeatured ? guessFeatured(addName.trim()) : null);
  function saveAdd() {
    if (byExchange) { onExchange?.(addName.trim()); adding = false; byExchange = false; addName = ""; return; }
    if (countOnly) { if (addN && addN > 0) onPullsTo?.(addN); adding = false; countOnly = false; addN = null; return; }
    if (!addN || addN < 1 || !onTopAt) return;
    onTopAt(addN, addName.trim());
    adding = false; addN = null; addName = "";
  }

  const inSoft = $derived(status.softFrom !== null && status.pity + 1 >= status.softFrom);
  const toSoft = $derived(status.softFrom !== null ? Math.max(0, status.softFrom - 1 - status.pity) : null);
  const lastHits = $derived(hits.slice(-4).reverse());
  // Without hard pity (Limbus) the ring tracks the first banner counter (200 exchange).
  const ringCounter = $derived(status.hardPity === null ? status.counters[0] : undefined);
  const counters = $derived(status.counters.filter((c) => c !== ringCounter));
  const active = $derived(activeBanners(banners));
  const others = $derived(banners.filter((b) => !active.includes(b)).slice(-6).reverse());
  const current = $derived(banners.find((b) => b.id === status.banner));
  let typing = $state(false);
  let detail = $state(false);
  const custom = $derived(typing || (status.banner !== "" && !current));
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
    {#if status.guaranteed !== null}
      <span class="chip" class:on={status.guaranteed}>
        {status.guaranteed ? "다음 픽업 확정" : "다음 50:50"}{status.guaranteeUncertain ? " ?" : ""}
      </span>
    {/if}
    {#if onChoose && chooseOptions.length}
      <select class="choose" value={chosen} onchange={(e) => onChoose((e.currentTarget as HTMLSelectElement).value)} aria-label="고른 무기">
        <option value="">고른 무기 선택</option>
        {#each chooseOptions as o (o)}<option value={o}>{o}</option>{/each}
      </select>
    {/if}
    {#if inSoft}<span class="chip hot">확률 상승 중</span>{/if}
    {#if status.hardPity}
      <span class="hint">천장까지 {Math.max(0, status.hardPity - status.pity)}회{#if !inSoft && toSoft !== null}{" · "}확률 상승까지 {toSoft}회{/if}</span>
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

{#if !current || custom}
<div class="banner">
  <span>배너</span>
  {#if custom || !banners.length}
    <input
      value={current ? "" : status.banner}
      placeholder="배너 이름 (천장 분리 기준)"
      onchange={(e) => { onBanner((e.currentTarget as HTMLInputElement).value.trim()); typing = false; }}
    />
  {:else}
    <select value={status.banner} onchange={(e) => {
      const v = (e.currentTarget as HTMLSelectElement).value;
      if (v === "__custom") typing = true; else onBanner(v);
    }}>
      {#if !current}<option value="">배너 선택</option>{/if}
      {#if active.length}
        <optgroup label="진행 중">
          {#each active as b (b.id)}<option value={b.id}>{bannerLabel(b)}</option>{/each}
        </optgroup>
      {/if}
      {#if others.length}
        <optgroup label="이전·다른 배너">
          {#each others as b (b.id)}<option value={b.id}>{bannerLabel(b)}{b.version ? ` (${b.version})` : ""}</option>{/each}
        </optgroup>
      {/if}
      <option value="__custom">직접 입력…</option>
    </select>
  {/if}
  {#if custom && banners.length}
    <button class="tolist" onclick={() => { typing = false; onBanner(""); }}>목록에서 선택</button>
  {:else if status.counters.length}<span class="hint">{status.bannerPulls}회</span>{/if}
</div>
{/if}
{#if current}
  <button class="binfo" onclick={() => (detail = !detail)} aria-expanded={detail}>
    {#each current.featured as f (f.id)}<span class="feat">{itemName(f)}</span>{/each}
    {#if daysLeft(current) !== null}<span class="dday">D-{daysLeft(current)}</span>{/if}
    <span class="bname">{current.name}</span>
    <span class="more">{detail ? "접기 ▲" : "자세히 ▼"}</span>
  </button>
  {#if detail}
    <BannerDetail
      banner={current}
      {banners}
      {groupLabel}
      {topLabel}
      pulls={status.counters.length ? status.bannerPulls : null}
      selected={status.banner}
      onSelect={onBanner}
      onClose={() => (detail = false)}
    />
  {/if}
{/if}

{#if onTopAt}
  {#if adding}
    <form class="add" onsubmit={(e) => { e.preventDefault(); saveAdd(); }}>
      <div class="aline">
        {#if !byExchange}
          <span>배너</span>
          <input class="n" type="number" inputmode="numeric" min="1" step={step} placeholder={String(status.bannerPulls + step)} bind:value={addN} aria-label="이 배너에서 몇 번째" />
          <span>번째</span>
        {/if}
        {#if canExchange}<label class="exch"><input type="checkbox" bind:checked={byExchange} />교환</label>{/if}
        {#if onPullsTo && !byExchange}<label class="exch"><input type="checkbox" bind:checked={countOnly} />횟수만</label>{/if}
      </div>
      {#if !countOnly}
        <div class="aline">
          <input class="nm" placeholder="{topLabel} 이름 (아래에서 고르거나 적기)" bind:value={addName} aria-label="이름" autocomplete="off" />
          {#if addFeatured === true}<span class="badge win">픽업</span>{:else if addFeatured === false}<span class="badge">픽뚫</span>{/if}
        </div>
        {#if picks.length}
          <!-- 이름 후보: 적은 글자가 들어간 것만(픽업 먼저). 누르면 이름 칸에 들어간다 -->
          <div class="picks">
            {#each picks as n (n)}
              <button type="button" class="pick" class:on={n === addName.trim()} class:feat={guessFeatured?.(n) === true} onclick={() => (addName = n)}>{n}</button>
            {/each}
          </div>
        {/if}
      {/if}
      <div class="aline end">
        <button type="submit" class="save" disabled={byExchange ? !addName.trim() : !addN}>저장</button>
        <button type="button" onclick={() => (adding = false)}>취소</button>
      </div>
    </form>
  {:else}
    <button class="addbtn" onclick={() => (adding = true)}>＋ {topLabel} 기록</button>
  {/if}
{/if}

{#if exchanges.length}
  <section class="hits">
    {#each exchanges as e (e.id)}
      <div class="hit">
        <span class="count">교환</span>
        <span class="name">{e.name ?? `${topLabel} (이름 미입력)`}</span>
        <span class="badge win">픽업/확천(교환)</span>
        {#if onRemoveExchange}<button class="x" onclick={() => onRemoveExchange(e.id)} aria-label="교환 기록 지우기">✕</button>{/if}
      </div>
    {/each}
  </section>
{/if}

{#if lastHits.length}
  <section class="hits">
    {#each lastHits as h (h.pull.id)}
      <div class="hit" class:lost={h.pull.featured === false}>
        <span class="count">{h.at}<small>번째</small></span>
        <span class="name">{h.pull.name ?? `${topLabel} (이름 미입력)`}</span>
        <span class="took">{h.count}뽑</span>
        {#if hitLabel(h)}<span class="badge" class:win={h.pull.featured === true}>{hitLabel(h)}</span>{/if}
      </div>
    {/each}
  </section>
{/if}

<style>
  .aline { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .aline.end { justify-content: flex-end; }
  .aline .save { font-weight: 700; padding: 6px 16px; }
  .picks { display: flex; flex-wrap: wrap; gap: 6px; }
  .pick { padding: 6px 10px; font-size: 13px; border-radius: var(--btn-radius); }
  .pick.feat { border-color: var(--top); font-weight: 700; }
  .pick.on { background: var(--top); color: #1a1408; }
  .exch { display: inline-flex; align-items: center; gap: 2px; white-space: nowrap; }
  .x { padding: 0 6px; font-size: 11px; }
  .choose { font-size: 12px; padding: 2px 4px; max-width: 100%; }
  .add { display: flex; flex-direction: column; gap: 6px; font-size: 13px; padding: 8px; border-radius: var(--radius); background: var(--panel); }
  .add .n { width: 5em; }
  .add .nm { flex: 1; min-width: 0; }
  .addbtn { align-self: flex-start; font-size: 12px; padding: 3px 10px; }
  .hero { display: flex; align-items: center; gap: 14px; }
  .hero.wide { flex-direction: column; align-items: stretch; gap: 8px; }
  .hero.wide .side { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
  .side { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; }
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
  .banner select, .banner input { width: 100%; }
  .binfo { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: -4px; font-size: 11px; width: 100%; padding: 4px 0; background: none; border: 0; text-align: left; box-shadow: none; }
  .tolist { padding: 4px 8px; font-size: 11px; white-space: nowrap; }
  .more { margin-left: auto; color: var(--accent); font-weight: 600; flex: none; }
  .feat { padding: 1px 7px; border-radius: var(--btn-radius); background: color-mix(in srgb, var(--top) 22%, transparent); color: var(--text); font-weight: 600; }
  .dday { color: var(--warn); font-weight: 700; }
  .bname { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }

  .hits { display: flex; flex-direction: column; gap: 4px; }
  .hit {
    display: flex; align-items: center; gap: 8px;
    padding: 5px 8px; border-radius: var(--radius); background: linear-gradient(90deg, var(--panel), transparent);
    border-left: 3px solid var(--top);
  }
  .hit.lost { border-left-style: dashed; }
  .count { font-family: var(--num-font); font-size: 19px; font-weight: 700; color: var(--top); font-variant-numeric: tabular-nums; }
  .count { white-space: nowrap; }
  .count small { font-size: 10px; font-weight: 500; margin-left: 1px; color: var(--muted); }
  .took { font-size: 11px; color: var(--muted); white-space: nowrap; }
  .name { flex: 1; min-width: 0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { flex: none; white-space: nowrap; font-size: 10px; padding: 2px 6px; border-radius: var(--btn-radius); background: var(--panel); border: 1px solid var(--line); color: var(--muted); }
  .badge.win { background: var(--top); color: #1a1408; font-weight: 700; }
</style>
