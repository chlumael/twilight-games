<script lang="ts">
  import {
    bannerDays, bannerLabel, bannerProgress, bannerState, formatMoment, itemName, remainingText,
    type PackBanner, type PackItem,
  } from "../lib/banners";

  let { banner, banners, groupLabel, topLabel, pulls, selected, onSelect, onClose }: {
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

  const STATE = { upcoming: "예정", active: "진행 중", ended: "종료", unknown: "일정 미확인" } as const;
  const state = $derived(bannerState(banner));
  const progress = $derived(bannerProgress(banner));
  const remaining = $derived(state === "active" ? remainingText(banner) : null);
  const days = $derived(bannerDays(banner));
  const schedule = $derived([...banners].sort((a, b) => (b.start ?? "").localeCompare(a.start ?? "")).slice(0, 12));

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
    <span class="state {state}">{STATE[state]}</span>
    <span class="kind">{groupLabel}{banner.version ? ` · ${banner.version} 버전` : ""}</span>
    <button class="close" onclick={onClose} aria-label="닫기">✕</button>
  </div>
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
      {#if banner.startApprox || banner.endApprox}
        <p class="note">"약"으로 표시된 시각은 공지에 정확한 날짜가 없어 추정한 값입니다. 하루쯤 다를 수 있습니다.</p>
      {/if}
    {:else}
      <p class="note">이 배너는 일정 정보가 없습니다.</p>
    {/if}
  </div>

  <div class="block">
    <div class="label">픽업</div>
    {#each banner.featured as f (f.id)}
      <div class="item"><span class="iname">{itemName(f)}</span><span class="grade top">{gradeLabel(f, true)}</span></div>
    {/each}
    {#each banner.featuredRare as f (f.id)}
      <div class="item"><span class="iname">{itemName(f)}</span><span class="grade">{gradeLabel(f, false)}</span></div>
    {/each}
    {#if !banner.featured.length && !banner.featuredRare.length}<p class="note">픽업 정보가 없습니다.</p>{/if}
  </div>

  <div class="block rows">
    {#if pulls !== null}<div><span class="label">이 배너에서 뽑은 횟수</span><b>{pulls}회</b></div>{/if}
    {#if banner.source}<div><span class="label">정보 출처</span><span>{banner.source}</span></div>{/if}
  </div>

  <div class="block">
    <div class="label">배너 일정 (최근 {schedule.length}개 · 누르면 그 배너로 바꿉니다)</div>
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
  .note { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.4; }
  .item { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 5px 8px; border-radius: var(--btn-radius); background: color-mix(in srgb, var(--top) 14%, transparent); }
  .iname { font-weight: 600; color: var(--text); font-size: 13px; word-break: keep-all; }
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
