<script lang="ts">
  // 친구 탭 (DESIGN.md §8.5, 사용자 2026-11-27: 그룹 없이 한 곳에 모아서). 공유를 켠 사람들의 요약으로
  // 전체 통계(평균 뽑기·픽업 성공)와 운 순위를 보여 준다. 운 = 평균적인 운 기준 상위 몇 %(작을수록 좋음).
  import { untrack } from "svelte";
  import Portrait from "./Portrait.svelte";
  import { GAMES } from "../lib/games";
  import { currencyIcon } from "../lib/icons";
  import { luckText, poolStats, ranking, type RankRow, type ShareSummary } from "../lib/share";
  import type { GameId } from "../lib/types";

  let { me, games, sharing, nickname, busy = false, onJoin, load }: {
    me: string;
    /** 보여 줄 게임 (설정의 "내 게임") */
    games: GameId[];
    /** 내가 공유를 켰는지 */
    sharing: boolean;
    nickname: string;
    busy?: boolean;
    /** 닉네임을 정하고 공유 켜기 */
    onJoin: (nickname: string) => void;
    load: () => Promise<{ uid: string; summary: ShareSummary }[]>;
  } = $props();

  const GAME_ICON: Record<GameId, string> = { genshin: "intertwined", arknights: "orundum", endfield: "oroberyl", limbus: "lunacy" };
  const SHOW = 20;
  let members = $state<{ uid: string; summary: ShareSummary }[] | null>(null);
  let error = $state("");
  let loading = $state(false);
  let picked = $state<string | null>(null);
  let name = $state(untrack(() => nickname));
  let tab = $state<"all" | GameId>("all");

  async function refresh() {
    loading = true;
    error = "";
    try {
      members = await load();
    } catch (e) {
      error = `불러오지 못했습니다: ${e instanceof Error ? e.message : e}`;
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    untrack(() => void refresh());
  });

  const gameOf = $derived(tab === "all" ? undefined : tab);
  const rows = $derived(members ? ranking(members, me, gameOf) : []);
  /** 위 20명 + (안에 없으면) 나 */
  const shown = $derived.by(() => {
    const top = rows.slice(0, SHOW);
    const mine = rows.findIndex((r) => r.me);
    return mine >= SHOW ? [...top, rows[mine]] : top;
  });
  const rankOf = (r: RankRow) => (r.luck === null ? "–" : String(rows.filter((x) => x.luck !== null).indexOf(r) + 1));
  const perGame = $derived(members ? games.map((g) => ({ g, st: poolStats(members!, me, g) })).filter((x) => x.st.people > 0) : []);
  const pickedSummary = $derived(members?.find((m) => m.uid === picked)?.summary ?? null);
  const ago = (iso: string) => {
    const h = Math.round((Date.now() - Date.parse(iso)) / 36e5);
    return h < 1 ? "방금" : h < 24 ? `${h}시간 전` : `${Math.round(h / 24)}일 전`;
  };
  const num = (n: number | null) => (n === null ? "–" : n.toFixed(1).replace(/\.0$/, ""));
</script>

<section class="friends">
  <div class="head">
    <strong class="title">친구</strong>
    <span class="sp"></span>
    <button class="small" onclick={refresh} disabled={loading}>{loading ? "불러오는 중…" : "새로고침"}</button>
  </div>

  {#if !sharing}
    <form class="join card" onsubmit={(e) => { e.preventDefault(); if (name.trim()) onJoin(name.trim()); }}>
      <b>나도 참여하기</b>
      <span class="muted small">닉네임과 뽑기 요약(뽑기 수·최고 등급·운)만 올라갑니다. 재화·이메일은 안 올라가고, 설정에서 언제든 끌 수 있어요</span>
      <div class="row">
        <input bind:value={name} maxlength="20" placeholder="닉네임" aria-label="닉네임" />
        <button type="submit" class="primary" disabled={busy || !name.trim()}>참여</button>
      </div>
    </form>
  {/if}

  {#if error}<p class="muted">{error}</p>{/if}
  {#if members && !members.length}<p class="muted">아직 참여한 사람이 없습니다.</p>{/if}

  {#if perGame.length}
    <!-- 전체 통계: 게임마다 참여 인원, 모두 합친 평균, 픽업 성공, 내 등수 -->
    <div class="pool card">
      {#each perGame as { g, st } (g)}
        <div class="prow">
          {#if currencyIcon(g, GAME_ICON[g])}<img src={currencyIcon(g, GAME_ICON[g])} alt="" />{/if}
          <span class="gname">{GAMES[g].shortName}</span>
          <span class="v"><b>{st.people}</b>명</span>
          <span class="v">평균 <b>{num(st.average)}</b></span>
          <span class="v">픽업 <b>{st.featuredRate === null ? "–" : `${Math.round(st.featuredRate * 100)}%`}</b></span>
          <span class="v me">{st.myRank ? `${st.myRank}위/${st.ranked}` : "–"}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if rows.length}
    <nav class="seg" aria-label="순위 보기">
      <button class:on={tab === "all"} onclick={() => (tab = "all")}>종합</button>
      {#each games as g (g)}<button class:on={tab === g} onclick={() => (tab = g)}>{GAMES[g].shortName}</button>{/each}
    </nav>
    <div class="rank card">
      <table>
        <thead><tr><th></th><th class="l">닉네임</th><th>뽑기</th><th>{gameOf ? GAMES[gameOf].topLabel : "최고"}</th><th>운</th></tr></thead>
        <tbody>
          {#each shown as r (r.uid)}
            <tr class:me={r.me} onclick={() => (picked = picked === r.uid ? null : r.uid)}>
              <td class="n">{rankOf(r)}</td>
              <td class="l">{r.nickname}{#if r.me}<em>나</em>{/if}</td>
              <td>{r.pulls.toLocaleString()}</td>
              <td>{r.tops}</td>
              <td class="luck">{luckText(r.luck)}{#if r.fewSamples && r.luck !== null}<small>표본 적음</small>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if rows.length > shown.length}<p class="muted small">위 {SHOW}명만 표시 · 전체 {rows.length}명</p>{/if}
    </div>
  {/if}

  {#if pickedSummary}
    <div class="who card">
      <div class="whead"><b>{pickedSummary.nickname}</b><span class="muted">{ago(pickedSummary.updatedAt)} · 직접 입력 {Math.round(pickedSummary.manualShare * 100)}%</span></div>
      {#each Object.entries(pickedSummary.games) as [g, x] (g)}
        {#if x && x.recent.length && (!gameOf || gameOf === g)}
          <div class="gl">{GAMES[g as GameId].shortName}</div>
          {#each x.recent as t, i (i)}
            <div class="hit" class:lost={t.featured === false}>
              <span class="cnt">{t.count}뽑</span><Portrait game={g as GameId} name={t.name} size={24} featured={t.featured} /><span class="nm">{t.name ?? "이름 미입력"}</span>
              {#if t.featured !== null}<span class="badge" class:win={t.featured}>{t.featured ? "픽업" : "픽뚫"}</span>{/if}
              <span class="muted d">{t.day.slice(5).replace("-", "/")}</span>
            </div>
          {/each}
        {/if}
      {/each}
    </div>
  {/if}
</section>

<style>
  .friends { display: flex; flex-direction: column; gap: 10px; font-size: 12px; }
  .head { display: flex; align-items: center; gap: 8px; }
  .title { font-size: 16px; }
  .sp { flex: 1; }
  .small { font-size: 11px; }
  button.small { font-size: 12px; padding: 3px 10px; }
  .join { display: flex; flex-direction: column; gap: 6px; padding: 10px; }
  .join b { font-size: 14px; }
  .row { display: flex; gap: 6px; }
  .row input { flex: 1; min-width: 0; }
  .primary { font-weight: 700; }
  .pool { display: flex; flex-direction: column; padding: 4px 10px; }
  .prow { display: grid; grid-template-columns: 20px 4.2em 3.2em 1fr 1fr auto; align-items: center; gap: 6px; padding: 7px 0; border-bottom: 1px solid var(--line); }
  .prow:last-child { border-bottom: 0; }
  .prow img { width: 20px; height: 20px; object-fit: contain; }
  .gname { font-weight: 700; color: var(--text); }
  .v { color: var(--muted); white-space: nowrap; }
  .v b { color: var(--text); font-size: 13px; }
  .v.me { color: var(--top); font-weight: 700; text-align: right; }
  .seg { display: flex; gap: 2px; padding: 3px; background: rgba(0, 0, 0, 0.2); border-radius: var(--radius); overflow-x: auto; }
  .seg button { flex: 1; border: 0; background: none; color: var(--muted); padding: 5px 8px; font-size: 12px; white-space: nowrap; border-radius: calc(var(--radius) * 0.7); }
  .seg button.on { background: var(--tab-active-bg); color: var(--tab-active-fg); font-weight: 700; }
  .rank, .who { display: flex; flex-direction: column; gap: 6px; padding: 10px; }
  .whead { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--text); }
  .whead .muted { margin-left: auto; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { font-size: 10px; font-weight: 600; color: var(--muted); text-align: right; padding: 0 3px 4px; }
  td { text-align: right; padding: 6px 3px; border-top: 1px solid var(--line); color: var(--text); white-space: nowrap; }
  .l { text-align: left; }
  td.l { font-weight: 600; overflow: hidden; text-overflow: ellipsis; max-width: 9em; }
  td.n { color: var(--muted); width: 1.8em; text-align: left; }
  td.luck { color: var(--top); font-weight: 700; }
  td.luck small { display: block; font-size: 9px; color: var(--muted); font-weight: 400; }
  tr { cursor: pointer; }
  tr.me td { background: color-mix(in srgb, var(--top) 10%, transparent); }
  em { font-style: normal; font-size: 9px; margin-left: 4px; padding: 0 4px; border-radius: 3px; background: var(--top); color: #1a1408; }
  .gl { font-weight: 700; color: var(--text); margin-top: 4px; }
  .hit { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: var(--btn-radius); background: color-mix(in srgb, var(--top) 12%, transparent); }
  .hit.lost { background: color-mix(in srgb, var(--muted) 14%, transparent); }
  .cnt { font-weight: 700; color: var(--top); min-width: 3.2em; }
  .nm { flex: 1; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { font-size: 10px; padding: 0 5px; border-radius: 3px; background: color-mix(in srgb, var(--muted) 30%, transparent); }
  .badge.win { background: var(--top); color: #000; }
  .d { font-size: 11px; }
</style>
