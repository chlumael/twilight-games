<script lang="ts">
  // 통계 → 친구: 그룹 멤버의 요약과 운 순위 (DESIGN.md §8.5). 운 = 평균적인 운 기준 상위 몇 %(작을수록 좋음).
  import { GAMES } from "../lib/games";
  import { currencyIcon } from "../lib/icons";
  import { luckText, ranking, type ShareSummary } from "../lib/share";
  import type { GameId } from "../lib/types";

  let { groups, me, games, load }: {
    groups: { code: string; name: string }[];
    me: string;
    /** 순위를 보여 줄 게임 (설정의 "내 게임") */
    games: GameId[];
    /** 그룹 멤버 요약 받아 오기 */
    load: (code: string) => Promise<{ uid: string; summary: ShareSummary }[] | null>;
  } = $props();

  const GAME_ICON: Record<GameId, string> = { genshin: "intertwined", arknights: "orundum", endfield: "oroberyl", limbus: "lunacy" };
  let code = $state("");
  let members = $state<{ uid: string; summary: ShareSummary }[] | null>(null);
  let error = $state("");
  let loading = $state(false);
  let picked = $state<string | null>(null);

  $effect(() => {
    if (!code && groups.length) code = groups[0].code;
  });
  $effect(() => {
    const c = code;
    if (c) void refresh(c);
  });
  async function refresh(c: string) {
    loading = true;
    error = "";
    try {
      members = await load(c);
      if (!members) error = "그룹을 찾지 못했습니다";
    } catch (e) {
      error = `불러오지 못했습니다: ${e instanceof Error ? e.message : e}`;
    } finally {
      loading = false;
    }
  }
  const sections = $derived(members ? [
    { key: "all", title: "종합", icon: undefined as string | undefined, rows: ranking(members, me) },
    ...games.map((g) => ({ key: g, title: GAMES[g].shortName, icon: currencyIcon(g, GAME_ICON[g]), rows: ranking(members!, me, g), top: GAMES[g].topLabel })),
  ].filter((s) => s.rows.length) : []);
  const pickedSummary = $derived(members?.find((m) => m.uid === picked)?.summary ?? null);
  const ago = (iso: string) => {
    const h = Math.round((Date.now() - Date.parse(iso)) / 36e5);
    return h < 1 ? "방금" : h < 24 ? `${h}시간 전` : `${Math.round(h / 24)}일 전`;
  };
</script>

<section class="friends">
  {#if !groups.length}
    <p class="muted">설정 → 친구 공유에서 그룹을 만들거나 초대 코드로 참가하세요.</p>
  {:else}
    <div class="bar">
      {#if groups.length > 1}
        <select bind:value={code} aria-label="그룹">{#each groups as g (g.code)}<option value={g.code}>{g.name}</option>{/each}</select>
      {:else}
        <b>{groups[0].name}</b>
      {/if}
      <span class="sp"></span>
      <button class="small" onclick={() => refresh(code)} disabled={loading}>{loading ? "불러오는 중…" : "새로고침"}</button>
    </div>
    {#if error}<p class="muted">{error}</p>{/if}
    {#if members && !members.length}<p class="muted">아직 공유한 멤버가 없습니다.</p>{/if}

    {#each sections as s (s.key)}
      <div class="rank card">
        <div class="rhead">{#if s.icon}<img src={s.icon} alt="" />{/if}<b>{s.title}</b></div>
        <table>
          <thead><tr><th></th><th class="l">닉네임</th><th>뽑기</th><th>{"top" in s ? s.top : "최고"}</th><th>운</th></tr></thead>
          <tbody>
            {#each s.rows as r, i (r.uid)}
              <tr class:me={r.me} onclick={() => (picked = picked === r.uid ? null : r.uid)}>
                <td class="n">{r.luck === null ? "–" : i + 1}</td>
                <td class="l">{r.nickname}{#if r.me}<em>나</em>{/if}</td>
                <td>{r.pulls.toLocaleString()}</td>
                <td>{r.tops}</td>
                <td class="luck">{luckText(r.luck)}{#if r.fewSamples && r.luck !== null}<small>표본 적음</small>{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/each}

    {#if pickedSummary}
      <div class="who card">
        <div class="rhead"><b>{pickedSummary.nickname}</b><span class="muted">{ago(pickedSummary.updatedAt)} · 직접 입력 {Math.round(pickedSummary.manualShare * 100)}%</span></div>
        {#each Object.entries(pickedSummary.games) as [g, x] (g)}
          {#if x && x.recent.length}
            <div class="gl">{GAMES[g as GameId].shortName}</div>
            {#each x.recent as t, i (i)}
              <div class="hit" class:lost={t.featured === false}>
                <span class="cnt">{t.count}뽑</span><span class="nm">{t.name ?? "이름 미입력"}</span>
                {#if t.featured !== null}<span class="badge" class:win={t.featured}>{t.featured ? "픽업" : "픽뚫"}</span>{/if}
                <span class="muted d">{t.day.slice(5).replace("-", "/")}</span>
              </div>
            {/each}
          {/if}
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  .friends { display: flex; flex-direction: column; gap: 10px; font-size: 12px; }
  .bar { display: flex; align-items: center; gap: 8px; }
  .sp { flex: 1; }
  .small { font-size: 12px; padding: 3px 10px; }
  .rank, .who { display: flex; flex-direction: column; gap: 6px; padding: 10px; }
  .rhead { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--text); }
  .rhead img { width: 18px; height: 18px; object-fit: contain; }
  .rhead .muted { margin-left: auto; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { font-size: 10px; font-weight: 600; color: var(--muted); text-align: right; padding: 0 3px 4px; }
  td { text-align: right; padding: 6px 3px; border-top: 1px solid var(--line); color: var(--text); white-space: nowrap; }
  .l { text-align: left; }
  td.l { font-weight: 600; overflow: hidden; text-overflow: ellipsis; max-width: 9em; }
  td.n { color: var(--muted); width: 1.5em; text-align: left; }
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
