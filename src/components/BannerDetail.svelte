<script lang="ts">
  import Portrait from "./Portrait.svelte";
  import { bannerImageUrl } from "../lib/images.svelte";
  import type { GameId } from "../lib/types";
  import {
    bannerDays, bannerLabel, bannerProgress, bannerState, formatMoment, itemName, leftText, remainingText,
    type PackBanner, type PackItem, type PoolEntry,
  } from "../lib/banners";

  let { banner, banners, groupLabel, topLabel, pulls, pool = null, selected, onSelect, onClose }: {
    /** 이 배너에서 나올 수 있는 최고 등급(규칙이 있는 종류만). byRule = 공지 목록이 없어 규칙으로 만든 것 */
    pool?: { entries: PoolEntry[]; byRule: boolean } | null;
    banner: PackBanner;
    /** 같은 종류의 배너 전체 (일정 목록용) */
    banners: PackBanner[];
    groupLabel: string;
    topLabel: string;
    /** 이 배너에서 뽑은 횟수. 배너별 집계를 안 하는 종류면 null */
    pulls: number | null;
    selected: string;
    onSelect: (id: string) => void;
    onClose: () => void;
  } = $props();
  const game = $derived(banner.id.split(":")[0] as GameId);
  const art = $derived(bannerImageUrl(game, banner.id));
  let artBroken = $state(false);

  const STATE = { upcoming: "예정", active: "진행 중", ended: "종료", unknown: "일정 미확인" } as const;
  const bstate = $derived(bannerState(banner));
  const progress = $derived(bannerProgress(banner));
  const remaining = $derived(bstate === "active" ? remainingText(banner) : null);
  const days = $derived(bannerDays(banner));
  const schedule = $derived([...banners].sort((a, b) => (b.start ?? "").localeCompare(a.start ?? "")).slice(0, 12));

  const offBanner = $derived((pool?.entries ?? []).filter((e) => !e.featured));
  /** 픽업이 앞으로 얼마나 더 나오는지 한 줄 (엔드필드 특별 허가: 다음 두 배너) */
  const upLeft = $derived.by(() => {
    const left = pool?.entries.find((e) => e.featured)?.left;
    if (left == null) return "";
    return left <= 1 ? "이 배너 뒤 목록에서 빠짐" : `다음 ${left - 1}개 배너까지 픽뚫로 나옴`;
  });
  function gradeLabel(i: PackItem, top: boolean): string {
    if (!i.grade) {
      if (top) return topLabel;
      const n = topLabel.match(/^(\d+)성$/); // "5성" → 함께 확률이 오르는 "4성"
      return n ? `${Number(n[1]) - 1}성` : "함께 픽업";
    }
    if (i.grade === "000") return "3성 인격";
    if (i.grade === "00") return "2성 인격";
    return `E.G.O · ${i.grade}`;
  }
  function shortDate(iso: string | null): string {
    if (!iso) return "미정";
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
</script>

<section class="detail card">
  <div class="dhead">
    <span class="state {bstate}">{STATE[bstate]}</span>
    <span class="kind">{groupLabel}{banner.version ? ` · ${banner.version} 버전` : ""}</span>
    <button class="close" onclick={onClose} aria-label="닫기">✕</button>
  </div>
  {#if art && !artBroken}<img class="art" src={art} alt="" loading="lazy" onerror={() => (artBroken = true)} />{/if}
  <h3>{banner.name}</h3>

  <div class="block">
    <div class="label">기간</div>
    {#if banner.start}
      <div class="period">
        <div><span class="tag">시작</span>{banner.startApprox ? "약 " : ""}{formatMoment(banner.start)}</div>
        <div><span class="tag">종료</span>{#if banner.end}{banner.endApprox ? "약 " : ""}{formatMoment(banner.end)}{:else}미정 (공지에 종료일 없음){/if}</div>
      </div>
      {#if progress !== null}
        <div class="bar"><div style:width="{progress * 100}%"></div></div>
      {/if}
      <div class="meta">
        {#if remaining}<b>{remaining}</b>{/if}
        {#if days !== null}<span>전체 {days}일</span>{/if}
      </div>
    {:else}
      <p class="note">이 배너는 일정 정보가 없습니다.</p>
    {/if}
  </div>

  <div class="block">
    <div class="label">픽업</div>
    {#each banner.featured as f (f.id)}
      <div class="item"><Portrait {game} name={itemName(f)} size={30} featured /><span class="iname">{itemName(f)}</span><span class="grade top">{gradeLabel(f, true)}</span></div>
    {/each}
    {#each banner.featuredRare as f (f.id)}
      <div class="item"><Portrait {game} name={itemName(f)} size={30} /><span class="iname">{itemName(f)}</span><span class="grade">{gradeLabel(f, false)}</span></div>
    {/each}
    {#if !banner.featured.length && !banner.featuredRare.length}<p class="note">픽업 정보가 없습니다.</p>{/if}
  </div>

  {#if offBanner.length}
    <div class="block">
      <div class="label">픽뚫로 나올 수 있는 {topLabel}{pool?.byRule ? " (규칙으로 계산)" : ""}</div>
      <div class="pool">
        {#each offBanner as e (e.name)}
          <span class="pchip" class:lim={e.left != null}><Portrait {game} name={e.name} size={20} />{e.name}{#if leftText(e.left)}<small>{leftText(e.left)}</small>{/if}</span>
        {/each}
      </div>
      {#if upLeft}<p class="note">픽업 {topLabel}: {upLeft}</p>{/if}
    </div>
  {/if}

  <div class="block rows">
    {#if pulls !== null}<div><span class="label">이 배너에서 뽑은 횟수</span><b>{pulls}회</b></div>{/if}
    {#if banner.source}<div><span class="label">정보 출처</span><span>{banner.source}</span></div>{/if}
  </div>

  <div class="block">
    <div class="label">배너 일정</div>
    <div class="list">
      {#each schedule as b (b.id)}
        {@const st = bannerState(b)}
        <button class="row" class:cur={b.id === selected} onclick={() => onSelect(b.id)}>
          <span class="dot {st}"></span>
          <span class="when">{shortDate(b.start)} ~ {shortDate(b.end)}</span>
          <span class="what">{bannerLabel(b)}</span>
        </button>
      {/each}
    </div>
  </div>
</section>

<style>
  /* 그림 비율은 게임마다 다르다(원신 2:1, 명방 1.83:1, 엔드필드·림버스 16:9) → 자르지 않고 원래 비율로 (사용자 지적 2026-11-27) */
  .art { width: 100%; height: auto; border-radius: var(--radius); display: block; background: var(--panel); }
  .detail { display: flex; flex-direction: column; gap: 10px; padding: 12px; font-size: 12px; }
  .dhead { display: flex; align-items: center; gap: 8px; }
  .kind { color: var(--muted); flex: 1; min-width: 0; }
  .close { padding: 2px 8px; }
  h3 { margin: 0; font-size: 15px; line-height: 1.35; color: var(--text); word-break: keep-all; }
  .state { padding: 1px 8px; border-radius: var(--btn-radius); font-weight: 700; background: color-mix(in srgb, var(--muted) 25%, transparent); }
  .state.active { background: color-mix(in srgb, var(--ok, #3fb950) 30%, transparent); }
  .state.upcoming { background: color-mix(in srgb, var(--accent) 30%, transparent); }
  .block { display: flex; flex-direction: column; gap: 5px; }
  .label { color: var(--muted); font-size: 11px; }
  .period { display: flex; flex-direction: column; gap: 3px; font-size: 13px; color: var(--text); }
  .tag { display: inline-block; width: 34px; color: var(--muted); font-size: 11px; }
  .bar { height: 5px; border-radius: 3px; background: color-mix(in srgb, var(--muted) 25%, transparent); overflow: hidden; }
  .bar div { height: 100%; background: var(--accent); }
  .meta { display: flex; gap: 10px; align-items: baseline; color: var(--muted); }
  .meta b { color: var(--warn); font-size: 13px; }
  .pool { display: flex; flex-wrap: wrap; gap: 5px; }
  .pchip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px 3px 3px; border-radius: var(--btn-radius); background: var(--panel); border: 1px solid var(--line); }
  .pchip.lim { border-color: var(--top); }
  .pchip small { color: var(--top); font-size: 10px; }
  .note { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.4; }
  .item { display: flex; align-items: center; gap: 8px; padding: 4px 8px 4px 4px; border-radius: var(--btn-radius); background: color-mix(in srgb, var(--top) 14%, transparent); }
  .iname { flex: 1; font-weight: 600; color: var(--text); font-size: 13px; word-break: keep-all; }
  .grade { flex: none; color: var(--muted); font-size: 11px; }
  .grade.top { color: var(--top); font-weight: 700; }
  .rows > div { display: flex; justify-content: space-between; gap: 8px; }
  .rows b { color: var(--text); }
  .list { display: flex; flex-direction: column; gap: 2px; max-height: 190px; overflow-y: auto; }
  .row { display: grid; grid-template-columns: 8px 86px 1fr; align-items: center; gap: 8px; padding: 5px 6px; text-align: left; background: none; border: 0; border-radius: var(--btn-radius); color: var(--text); font-size: 12px; }
  .row.cur { background: color-mix(in srgb, var(--accent) 18%, transparent); }
  .when { color: var(--muted); font-variant-numeric: tabular-nums; }
  .what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: color-mix(in srgb, var(--muted) 45%, transparent); }
  .dot.active { background: var(--ok, #3fb950); }
  .dot.upcoming { background: none; box-shadow: inset 0 0 0 2px var(--accent); }
</style>
