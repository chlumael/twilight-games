<script lang="ts">
  // 통계: 내 게임 전체를 한 화면에 (사용자 요청 2026-11-26 "하나씩 보는 게 아니라 한꺼번에").
  // 위: 게임별 요약 한 줄씩, 아래: 게임마다 종류별 표. 게임별 자세한 내용(최고 등급 목록·배너별·기록 정리)은 "자세히"로 펼친다.
  import { untrack } from "svelte";
  import { GAMES } from "../lib/games";
  import { gameIcon } from "../lib/icons";
  import { gameStats, luckLabel } from "../lib/stats";
  import type { GameId, Records } from "../lib/types";
  import GameStats from "./GameStats.svelte";

  let { records, games, game, bannerName, onRemove, onReset, onResetBanner }: {
    records: Records;
    /** 보여 줄 게임 (설정의 "내 게임") */
    games: GameId[];
    /** 지금 보던 게임: 처음에 "자세히"를 펼쳐 둔다 */
    game: GameId;
    bannerName: (game: GameId, id: string) => string;
    onRemove?: (game: GameId, keys: string[], label: string) => void;
    onReset?: (game: GameId, groupId: string) => void;
    onResetBanner?: (game: GameId, groupId: string, bannerId: string) => void;
  } = $props();

  const all = $derived(games.map((g) => ({ g, s: gameStats(records.games[g], g) })));
  const used = $derived(all.filter((x) => x.s.pulls > 0));
  let open = $state<GameId | null>(untrack(() => game));

  const num = (n: number | null) => (n === null ? "–" : n.toFixed(1).replace(/\.0$/, ""));
  const pct = (n: number | null) => (n === null ? "–" : `${Math.round(n * 100)}%`);
  /** "운 상위 2%" → "상위 2%" (표 칸이 좁아서) */
  const luckShort = (s: ReturnType<typeof gameStats>["groups"][number], g: GameId) => luckLabel(s, g)?.replace(/^운 /, "") ?? "–";
</script>

<section class="stats">
  <strong class="title">내 통계</strong>

  {#if !used.length}
    <p class="muted">아직 기록된 뽑기가 없습니다.</p>
  {:else}
    <!-- 게임별 요약 -->
    <div class="sum card">
      {#each all as { g, s } (g)}
        <div class="srow" class:none={!s.pulls}>
          {#if gameIcon(g)}<img src={gameIcon(g)} alt="" />{/if}
          <span class="gname">{GAMES[g].shortName}</span>
          {#if s.pulls}
            <span class="v"><b>{s.pulls.toLocaleString()}</b>회</span>
            <span class="v">{GAMES[g].topLabel} <b>{s.tops}</b>개</span>
            <span class="v">평균 <b>{num(s.average)}</b></span>
          {:else}
            <span class="v muted">기록 없음</span>
          {/if}
        </div>
      {/each}
    </div>

    <!-- 게임마다 종류별 표 -->
    {#each used as { g, s } (g)}
      {@const def = GAMES[g]}
      <div class="game card">
        <div class="ghead">
          {#if gameIcon(g)}<img src={gameIcon(g)} alt="" />{/if}
          <b>{def.name}</b>
          {#if s.spent}<span class="muted spent">{s.spent.label} {Math.round(s.spent.amount).toLocaleString()} 사용</span>{/if}
          {#if s.firstPull && s.lastPull}<span class="muted when">{s.firstPull.slice(5, 10).replace("-", "/")} ~ {s.lastPull.slice(5, 10).replace("-", "/")}</span>{/if}
        </div>
        <table>
          <thead><tr><th>종류</th><th>뽑기</th><th>{def.topLabel}</th><th>평균</th><th>픽업</th><th>운</th></tr></thead>
          <tbody>
            {#each s.groups.filter((x) => x.pulls > 0) as x (x.groupId)}
              <tr>
                <td class="kind">{x.name}</td>
                <td>{x.pulls}</td>
                <td>{x.tops}</td>
                <td>{num(x.average)}</td>
                <td>{x.featuredWon + x.featuredLost ? pct(x.featuredRate) : "–"}</td>
                <td class:luck={luckShort(x, g) !== "–"}>{luckShort(x, g)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <button class="more" onclick={() => (open = open === g ? null : g)} aria-expanded={open === g}>
          {open === g ? "접기 ▲" : "자세히 ▼"}
        </button>
        {#if open === g}
          <GameStats game={g} record={records.games[g]} bannerName={(id) => bannerName(g, id)}
            onRemove={onRemove ? (keys, label) => onRemove(g, keys, label) : undefined}
            onReset={onReset ? (gid) => onReset(g, gid) : undefined}
            onResetBanner={onResetBanner ? (gid, bid) => onResetBanner(g, gid, bid) : undefined} />
        {/if}
      </div>
    {/each}
  {/if}
</section>

<style>
  .stats { display: flex; flex-direction: column; gap: 10px; font-size: 12px; }
  .title { font-size: 16px; }
  .sum { display: flex; flex-direction: column; padding: 4px 10px; }
  .srow { display: grid; grid-template-columns: 20px 4.5em 1fr 1fr 1.2fr; align-items: center; gap: 6px; padding: 7px 0; border-bottom: 1px solid var(--line); }
  .srow:last-child { border-bottom: 0; }
  .srow.none { opacity: 0.5; }
  .srow img, .ghead img { width: 20px; height: 20px; object-fit: contain; }
  .gname { font-weight: 700; color: var(--text); }
  .v { color: var(--muted); white-space: nowrap; }
  .v b { color: var(--text); font-size: 14px; margin-right: 1px; }
  .game { display: flex; flex-direction: column; gap: 8px; padding: 10px; }
  .ghead { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--text); }
  .when { margin-left: auto; font-size: 11px; }
  .spent { font-size: 11px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { font-size: 10px; font-weight: 600; color: var(--muted); text-align: right; padding: 0 2px 4px; }
  td { text-align: right; padding: 5px 2px; border-top: 1px solid var(--line); color: var(--text); white-space: nowrap; }
  th:first-child, td.kind { text-align: left; }
  td.kind { font-weight: 600; }
  td.luck { color: var(--top); font-weight: 700; }
  .more { align-self: flex-start; font-size: 12px; padding: 3px 10px; }
</style>
