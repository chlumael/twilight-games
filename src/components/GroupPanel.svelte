<script lang="ts">
  import Portrait from "./Portrait.svelte";
  import { activeBanners, bannerLabel, bannerState, daysLeft, itemName, type PackBanner, type PoolEntry } from "../lib/banners";
  import { hitLabel, pathText, type GroupStatus, type TopHit } from "../lib/ledger";
  import type { Exchange, GameId, Pull } from "../lib/types";
  import BannerDetail from "./BannerDetail.svelte";
  import PityBar from "./PityBar.svelte";
  import PityRing from "./PityRing.svelte";
  import PullStrip from "./PullStrip.svelte";

  let { game, status, topLabel, groupLabel = "", recent, hits, gauge, banners = [], onBanner, topNames = [], guessFeatured, onTopAt, chooseOptions = [], chosen = "", onChoose, exchanges = [], onExchange, onRemoveExchange, onPullsTo, poolOf, freeLabel = "", onFreeTop, share = 0.5, onEditTop, onRemoveTop }: {
    groupLabel?: string;
    game: GameId;
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
    /** 원신 무기·묶음 기원: 고를 수 있는 무기(이 배너 픽업)와 지금 고른 무기 */
    chooseOptions?: string[];
    chosen?: string;
    onChoose?: (name: string) => void;
    /** 교환으로 얻은 기록(이 종류·배너). 교환 카운터가 있는 종류에서만 입력을 보여 준다 */
    exchanges?: Exchange[];
    onExchange?: (name: string, option?: { cost: number; low?: boolean }) => void;
    onRemoveExchange?: (id: string) => void;
    /** 최고 등급 없이 "이 배너에서 n번째까지 뽑았다"만 맞추기 */
    onPullsTo?: (n: number) => void;
    /** 배너에서 나올 수 있는 최고 등급 목록(규칙이 있는 종류만) */
    poolOf?: (b: PackBanner) => { entries: PoolEntry[]; byRule: boolean } | null;
    /** 무료 뽑기(엔드필드 긴급 모집) 이름. 있으면 "천장·횟수에 안 들어가는 기록"을 넣을 수 있다 */
    freeLabel?: string;
    onFreeTop?: (name: string) => void;
    /** 확정이 아닐 때 최고 등급 중 픽업이 나올 확률 (원신 무기 0.75) */
    share?: number;
    /** 최고 등급 기록 고치기·지우기 (n은 지금 배너 기록만) */
    onEditTop?: (id: string, change: { name: string | null; featured: boolean | null; n?: number }) => void;
    onRemoveTop?: (id: string) => void;
  } = $props();
  let byFree = $state(false);
  let countOnly = $state(false);
  const canExchange = $derived(!!onExchange && status.counters.some((c) => /교환/.test(c.label)));
  let byExchange = $state(false);
  /** 교환 가격 고르기 (명일방주 300 / 200 / 5성 75) */
  const exchangeCounter = $derived(status.counters.find((c) => c.options?.length));
  let exchangeCost = $state(0);
  const exchangeOption = $derived(exchangeCounter?.options?.find((o) => o.cost === exchangeCost) ?? exchangeCounter?.options?.[0]);

  /** 한 번에 뽑는 단위(엔드필드 무기 신청 = 10) */
  const step = $derived(status.unit);
  let adding = $state(false);
  let addN = $state<number | null>(null);
  let addName = $state("");
  /** 이름 후보: 적은 글자를 포함하는 것(앞에서부터 맞는 것 먼저). 아무것도 안 적었으면 목록이 짧을 때만 전부 */
  const picks = $derived(picksFor(addName));
  function picksFor(text: string): string[] {
    const q = text.trim().replace(/\s+/g, "");
    if (topNames.length <= 12) return topNames; // 후보가 적으면(배너에 정해진 목록) 늘 전부 보여 준다
    if (!q) return topNames.slice(0, 6);
    const hit = topNames.filter((n) => n.replace(/\s+/g, "").includes(q));
    return [...hit.filter((n) => n.replace(/\s+/g, "").startsWith(q)), ...hit.filter((n) => !n.replace(/\s+/g, "").startsWith(q))].slice(0, 10);
  }
  const addFeatured = $derived(addName.trim() && guessFeatured ? guessFeatured(addName.trim()) : null);
  function saveAdd() {
    if (byFree) { onFreeTop?.(addName.trim()); adding = false; byFree = false; addName = ""; return; }
    if (byExchange) { onExchange?.(addName.trim(), exchangeOption); adding = false; byExchange = false; addName = ""; exchangeCost = 0; return; }
    if (countOnly) { if (addN && addN > 0) onPullsTo?.(addN); adding = false; countOnly = false; addN = null; return; }
    if (!addN || addN < 1 || !onTopAt) return;
    onTopAt(addN, addName.trim());
    adding = false; addN = null; addName = "";
  }

  const inSoft = $derived(status.softFrom !== null && status.pity + 1 >= status.softFrom);
  const toSoft = $derived(status.softFrom !== null ? Math.max(0, status.softFrom - 1 - status.pity) : null);
  let allHits = $state(false);
  const lastHits = $derived((allHits ? hits : hits.slice(-4)).slice().reverse());
  // 기록 고치기 (사용자 2026-11-27): 줄을 누르면 그 자리에서 이름·픽업·번째를 고친다
  let editId = $state<string | null>(null);
  let editName = $state("");
  let editN = $state<number | null>(null);
  let editFeat = $state<boolean | null>(null);
  let confirmDel = $state(false);
  const editPicks = $derived(picksFor(editName));
  function openEdit(h: TopHit) {
    if (!onEditTop) return;
    if (editId === h.pull.id) { editId = null; return; }
    editId = h.pull.id; editName = h.pull.name ?? ""; editN = h.at; editFeat = h.pull.featured; confirmDel = false;
  }
  function saveEdit(h: TopHit) {
    const onBannerNow = h.pull.banner === status.banner;
    onEditTop?.(h.pull.id, { name: editName.trim() || null, featured: editFeat, ...(onBannerNow && editN && editN !== h.at ? { n: editN } : {}) });
    editId = null;
  }
  function pickEdit(n: string) {
    editName = n;
    const g = guessFeatured?.(n);
    if (g !== undefined && g !== null) editFeat = g;
  }
  // Without hard pity (Limbus) the ring tracks the first banner counter (200 exchange).
  const ringCounter = $derived(status.hardPity === null ? status.counters[0] : undefined);
  const counters = $derived(status.counters.filter((c) => c !== ringCounter));
  const active = $derived(activeBanners(banners));
  const others = $derived(banners.filter((b) => !active.includes(b)).slice(-6).reverse());
  const current = $derived(banners.find((b) => b.id === status.banner));
  /** 지금 배너가 끝났는지 (남은 교환 재화가 다른 것으로 바뀌었음을 보여 준다) */
  const ended = $derived(!!current && bannerState(current) === "ended");
  let typing = $state(false);
  /** 배너 고르기·입력 칸을 펼쳤는지 (배너 자료에 지금 배너가 없을 때만) */
  let editing = $state(false);
  let detail = $state(false);
  const custom = $derived(typing || (status.banner !== "" && !current));
</script>

<section class="hero" class:wide={gauge === "bar" && status.hardPity}>
  {#if gauge === "bar" && status.hardPity}
    <PityBar value={status.pity} max={status.hardPity} soft={status.softFrom} />
  {:else if ringCounter}
    <!-- 교환 카운터(림버스 이상)는 가운데 큰 숫자도 그 재화 수. 000 이후 횟수를 크게 쓰면 000이 나올 때 "이상이 0"처럼 보였다(사용자 2026-11-27) -->
    <PityRing value={ringCounter.at - ringCounter.remaining} max={ringCounter.at} label={String(ringCounter.held ?? status.pity)}
      sub={`${ringCounter.label}까지 ${ringCounter.remaining}`} size={100} />
  {:else}
    <PityRing value={status.pity} max={status.hardPity} soft={status.softFrom} sub={status.hardPity ? `/ ${status.hardPity}` : undefined} size={100} />
  {/if}
  <div class="side">
    {#if status.guaranteed !== null}
      <span class="chip" class:on={status.guaranteed}>
        {status.guaranteed ? (status.radiant ? "다음 픽업 확정(별빛 포착)" : "다음 픽업 확정") : share === 0.5 ? "다음 50:50" : `다음 픽업 ${Math.round(share * 100)}%`}{status.guaranteeUncertain ? " ?" : ""}
      </span>
    {/if}
    {#if onChoose && chooseOptions.length}
      <select class="choose" value={chosen} onchange={(e) => onChoose((e.currentTarget as HTMLSelectElement).value)} aria-label="고른 무기">
        <option value="">고른 무기 선택</option>
        {#each chooseOptions as o (o)}<option value={o}>{o}</option>{/each}
      </select>
    {/if}
    {#if inSoft}<span class="chip hot">확률 상승 중</span>{/if}
    {#if ringCounter?.held !== undefined}
      <span class="hint">{topLabel} 이후 {status.pity}회</span>
    {/if}
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
          <span class:ok={done || c.active}>{done ? "완료" : c.active ? "적용 중" : `${c.remaining}회 남음`}</span>
        </div>
        <div class="mini"><div style:width="{done ? 100 : ((c.at - c.remaining) / c.at) * 100}%"></div></div>
        {#if c.leftover && c.held && ended}<div class="left">배너 종료 · {c.leftover.to} {(c.held * c.leftover.rate).toLocaleString()}개로</div>{/if}
      </div>
    {/each}
  </section>
{/if}

<section class="history">
  <div class="htitle"><span>최근 40회</span><span class="legend"><i class="dot"></i>{topLabel}</span></div>
  <PullStrip pulls={recent} />
</section>

{#if (!current || custom) && !editing}
  <!-- 배너 자료에 지금 배너가 없을 때: 한 줄로만 보이고, 눌러야 고르기·입력 칸이 나온다 -->
  <button class="binfo bset" onclick={() => (editing = true)}>
    <span class="feat">{status.banner || "배너 미지정"}</span>
    {#if status.counters.length}<span class="muted">{status.bannerPulls}회</span>{/if}
    <span class="more">바꾸기 ✎</span>
  </button>
{:else if !current || custom}
<div class="banner">
  <span>배너</span>
  {#if custom || !banners.length}
    <input
      value={current ? "" : status.banner}
      placeholder="배너 이름 (천장 분리 기준)"
      onchange={(e) => { onBanner((e.currentTarget as HTMLInputElement).value.trim()); typing = false; editing = false; }}
    />
  {:else}
    <select value={status.banner} onchange={(e) => {
      const v = (e.currentTarget as HTMLSelectElement).value;
      if (v === "__custom") typing = true; else { onBanner(v); editing = false; }
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
    {#each current.featured as f (f.id)}<span class="feat"><Portrait {game} name={itemName(f)} size={22} featured />{itemName(f)}</span>{/each}
    {#if daysLeft(current) !== null}<span class="dday">D-{daysLeft(current)}</span>{/if}
    {#if !current.featured.length || !current.featured.every((f) => current.name.includes(itemName(f)))}<span class="bname">{current.name}</span>{/if}
    <span class="more">{detail ? "접기 ▲" : "자세히 ▼"}</span>
  </button>
  {#if detail}
    <BannerDetail
      banner={current}
      {banners}
      {groupLabel}
      {topLabel}
      pulls={status.counters.length ? status.bannerPulls : null}
      pool={poolOf?.(current) ?? null}
      selected={status.banner}
      onSelect={onBanner}
      onClose={() => (detail = false)}
    />
  {/if}
{/if}

{#if onTopAt}
  {#if adding}
    <form class="add" novalidate onsubmit={(e) => { e.preventDefault(); saveAdd(); }}>
      <div class="aline">
        {#if !byExchange && !byFree}
          <span>배너</span>
          <input class="n" type="number" inputmode="numeric" min={step} step={step} placeholder={String(status.bannerPulls + step)} bind:value={addN} aria-label="이 배너에서 몇 번째" />
          <span>번째</span>
        {/if}
        {#if canExchange}<label class="exch"><input type="checkbox" bind:checked={byExchange} />교환</label>{/if}
        {#if byExchange && exchangeCounter?.options}
          <select bind:value={exchangeCost} aria-label="교환 가격">
            {#each exchangeCounter.options as o (o.cost)}<option value={o.cost}>{o.label}</option>{/each}
          </select>
        {/if}
        {#if freeLabel && onFreeTop && !countOnly}<label class="exch"><input type="checkbox" bind:checked={byFree} />{freeLabel}(무료)</label>{/if}
        {#if onPullsTo && !byExchange && !byFree}<label class="exch"><input type="checkbox" bind:checked={countOnly} />횟수만</label>{/if}
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
              <button type="button" class="pick" class:on={n === addName.trim()} class:feat={guessFeatured?.(n) === true} onclick={() => (addName = n)}><Portrait {game} name={n} size={22} />{n}</button>
            {/each}
          </div>
        {/if}
      {/if}
      <div class="aline end">
        <button type="submit" class="save" disabled={byExchange ? !addName.trim() && !exchangeOption?.low : byFree ? false : !addN}>저장</button>
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
        <span class="count txt">{e.kind === "free" ? freeLabel || "무료" : "교환"}</span>
        <span class="name">{e.name ?? (e.low ? "5성" : `${topLabel} (이름 미입력)`)}</span>
        {#if e.kind === "free"}
          {#if e.featured != null}<span class="badge" class:win={e.featured}>{e.featured ? "픽업" : "픽뚫"}</span>{/if}
        {:else if e.low}
          <span class="badge">교환 {e.cost ?? ""}</span>
        {:else}
          <span class="badge win">픽업/확천(교환)</span>
        {/if}
        {#if onRemoveExchange}<button class="x" onclick={() => onRemoveExchange(e.id)} aria-label="기록 지우기">✕</button>{/if}
      </div>
    {/each}
  </section>
{/if}

{#if lastHits.length}
  <section class="hits">
    {#each lastHits as h (h.pull.id)}
      <button type="button" class="hit tap" class:lost={h.pull.featured === false} class:open={editId === h.pull.id} onclick={() => openEdit(h)} disabled={!onEditTop}>
        <!-- 큰 숫자 = 0스택부터 몇 뽑 만에 나왔는지(사용자 2026-11-27: 배너 몇 번째보다 이것이 중요). 픽뚫 뒤 픽업이면 둘을 더한 횟수도 -->
        <span class="count">{h.count}<small>뽑</small></span>
        <Portrait {game} name={h.pull.name} size={30} featured={h.pull.featured} />
        <span class="name">{h.pull.name ?? `${topLabel} (이름 미입력)`}</span>
        {#if hitLabel(h)}<span class="badge" class:win={h.pull.featured === true}>{hitLabel(h)}</span>{/if}
      </button>
      <!-- 픽업이면 그 픽업을 뽑기까지 나온 최고 등급과 처음부터 센 위치(사용자 2026-11-28) -->
      {#if pathText(h, topLabel)}<div class="path">{pathText(h, topLabel)}</div>{/if}
      {#if editId === h.pull.id}
        <form class="add edit" novalidate onsubmit={(e) => { e.preventDefault(); saveEdit(h); }}>
          <div class="aline">
            {#if h.pull.banner === status.banner}
              <span>배너</span>
              <input class="n" type="number" inputmode="numeric" min={step} step={step} bind:value={editN} aria-label="몇 번째" />
              <span>번째</span>
            {/if}
            <span class="seg3">
              <button type="button" class:on={editFeat === true} onclick={() => (editFeat = true)}>픽업</button>
              <button type="button" class:on={editFeat === false} onclick={() => (editFeat = false)}>픽뚫</button>
              <button type="button" class:on={editFeat === null} onclick={() => (editFeat = null)}>모름</button>
            </span>
          </div>
          <div class="aline"><input class="nm" placeholder="{topLabel} 이름" bind:value={editName} aria-label="이름" autocomplete="off" /></div>
          {#if editPicks.length}
            <div class="picks">
              {#each editPicks as n (n)}
                <button type="button" class="pick" class:on={n === editName.trim()} class:feat={guessFeatured?.(n) === true} onclick={() => pickEdit(n)}><Portrait {game} name={n} size={22} />{n}</button>
              {/each}
            </div>
          {/if}
          <div class="aline end">
            {#if onRemoveTop}
              <button type="button" class="del" onclick={() => { if (confirmDel) { onRemoveTop(h.pull.id); editId = null; } else confirmDel = true; }}>{confirmDel ? "한 번 더 누르면 지움" : "지우기"}</button>
            {/if}
            <span class="sp"></span>
            <button type="submit" class="save">저장</button>
            <button type="button" onclick={() => (editId = null)}>취소</button>
          </div>
        </form>
      {/if}
    {/each}
    {#if hits.length > 4}<button type="button" class="morehits" onclick={() => (allHits = !allHits)}>{allHits ? "최근 4개만" : `전체 ${hits.length}개 보기`}</button>{/if}
  </section>
{/if}

<style>
  .aline { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .aline.end { justify-content: flex-end; }
  .aline .save { font-weight: 700; padding: 6px 16px; }
  .picks { display: flex; flex-wrap: wrap; gap: 6px; }
  .pick { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px 3px 3px; font-size: 13px; border-radius: var(--btn-radius); }
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

  .left { font-size: 10px; color: var(--muted); margin-top: 3px; }
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
  .feat { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px 1px 1px; border-radius: var(--btn-radius); background: color-mix(in srgb, var(--top) 22%, transparent); color: var(--text); font-weight: 600; }
  .dday { color: var(--warn); font-weight: 700; }
  .bname { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }

  .hits { display: flex; flex-direction: column; gap: 4px; }
  .hit {
    display: flex; align-items: center; gap: 8px;
    padding: 5px 8px; border-radius: var(--radius); background: linear-gradient(90deg, var(--panel), transparent);
    border-left: 3px solid var(--top);
  }
  .hit.lost { border-left-style: dashed; }
  button.hit.tap { width: 100%; text-align: left; border-top: 0; border-right: 0; border-bottom: 0; box-shadow: none; font: inherit; color: inherit; cursor: pointer; }
  button.hit.tap:disabled { cursor: default; opacity: 1; }
  button.hit.open { background: color-mix(in srgb, var(--top) 14%, var(--panel)); }
  .edit { margin: -2px 0 4px; }
  .seg3 { display: inline-flex; gap: 2px; margin-left: auto; }
  .seg3 button { padding: 4px 9px; font-size: 12px; }
  .seg3 button.on { background: var(--top); color: #1a1408; font-weight: 700; }
  .del { color: var(--warn); font-size: 12px; }
  .sp { flex: 1; }
  .morehits { align-self: center; font-size: 11px; padding: 2px 10px; background: none; border: 0; color: var(--accent); box-shadow: none; }
  .count { font-family: var(--num-font); font-size: 19px; font-weight: 700; color: var(--top); font-variant-numeric: tabular-nums; }
  .count { white-space: nowrap; }
  .count.txt { font-family: inherit; font-size: 13px; }
  .count small { font-size: 10px; font-weight: 500; margin-left: 1px; color: var(--muted); }
  .path { margin: -2px 0 2px 11px; font-size: 11px; color: var(--muted); line-height: 1.4; }
  .name { flex: 1; min-width: 0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { flex: none; white-space: nowrap; font-size: 10px; padding: 2px 6px; border-radius: var(--btn-radius); background: var(--panel); border: 1px solid var(--line); color: var(--muted); }
  .badge.win { background: var(--top); color: #1a1408; font-weight: 700; }
</style>
