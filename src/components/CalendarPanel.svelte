<script lang="ts">
  import { untrack } from "svelte";
  // 달력 (사용자 요청 2026-11-26): 픽업 기간, 게임 안 이벤트, 버전 시작·끝, 외부 행사, 내 일정.
  import {
    buildItems, dayOf, dText, edgeOn, KIND_LABEL, monthCells, onDay, periodText, validMine, ymd,
    type CalItem, type CalKind, type MyEvent,
  } from "../lib/calendar";
  import type { BannerPack } from "../lib/banners";
  import { GAME_IDS, GAMES } from "../lib/games";
  import type { GameId } from "../lib/types";

  let { pack, mine = [], game, onMine, onClose }: {
    pack: BannerPack | null;
    mine?: MyEvent[];
    /** 지금 보고 있는 게임 (게임 고르기의 처음 값) */
    game: GameId;
    onMine: (list: MyEvent[]) => void;
    onClose: () => void;
  } = $props();

  // 게임마다 다른 색 (달력 칸의 점·막대)
  const COLOR: Record<string, string> = { genshin: "#6fb6ff", arknights: "#9aa3ad", endfield: "#ffcf3a", limbus: "#e0534a", none: "#b48cff" };
  const KINDS: CalKind[] = ["pickup", "event", "version", "offline", "mine"];

  let games = $state<Set<GameId>>(new Set([untrack(() => game)])); // 처음에는 지금 보던 게임만
  let kinds = $state<Set<CalKind>>(new Set(KINDS));
  const now = Date.now();
  let month = $state({ y: new Date(now).getFullYear(), m: new Date(now).getMonth() });
  let picked = $state(dayOf(now));

  const all = $derived(buildItems(pack, mine));
  const shown = $derived(all.filter((it) => kinds.has(it.kind) && (it.game === null || games.has(it.game))));
  const cells = $derived(monthCells(month.y, month.m));
  const dayItems = $derived(sortForDay(onDay(shown, picked, now), picked));

  function sortForDay(list: CalItem[], day: number): CalItem[] {
    const rank = (it: CalItem) => (edgeOn(it, day) ? 0 : 1) * 10 + KINDS.indexOf(it.kind);
    return [...list].sort((a, b) => rank(a) - rank(b) || a.start - b.start);
  }
  function toggle<T>(set: Set<T>, v: T): Set<T> {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    return next;
  }
  function move(d: number) {
    const t = new Date(month.y, month.m + d, 1);
    month = { y: t.getFullYear(), m: t.getMonth() };
  }
  function goToday() {
    month = { y: new Date(now).getFullYear(), m: new Date(now).getMonth() };
    picked = dayOf(now);
  }
  /** 그 칸에 그릴 표시: 게임별 점(최대 4) + 그날 시작·끝나는 것이 있으면 강조 */
  function marks(day: number) {
    const list = onDay(shown, day, now);
    const games = [...new Set(list.map((it) => it.game ?? "none"))].slice(0, 4);
    const edge = list.some((it) => edgeOn(it, day));
    const version = list.some((it) => it.kind === "version" && edgeOn(it, day) === "start");
    return { games, edge, version, n: list.length };
  }

  // 내 일정 넣기
  let adding = $state(false);
  let draft = $state<{ title: string; start: string; end: string; game: GameId | "" }>({ title: "", start: "", end: "", game: "" });
  function openAdd() {
    draft = { title: "", start: ymd(picked), end: "", game: games.size === 1 ? [...games][0] : "" };
    adding = true;
  }
  function saveMine() {
    const ev: Partial<MyEvent> = { id: `${Date.now().toString(36)}`, title: draft.title.trim(), start: draft.start, end: draft.end || null, game: draft.game || null };
    if (!validMine(ev)) return;
    onMine([...mine, ev]);
    adding = false;
    if (draft.game) games = new Set([...games, draft.game]);
    kinds = new Set([...kinds, "mine"]);
  }
  function removeMine(id: string) {
    onMine(mine.filter((m) => `mine:${m.id}` !== id));
  }
  const pickedText = $derived.by(() => {
    const d = new Date(picked);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${"일월화수목금토"[d.getDay()]})${dayOf(now) === picked ? " · 오늘" : ""}`;
  });
</script>

<section class="cal">
  <div class="chead">
    <strong>달력</strong>
    <button class="small" onclick={goToday}>오늘</button>
    <button class="close" onclick={onClose} aria-label="닫기">✕</button>
  </div>

  <div class="filters">
    <div class="chips">
      {#each GAME_IDS as id (id)}
        <button class="chip" class:on={games.has(id)} style:--c={COLOR[id]} onclick={() => (games = toggle(games, id))}>
          <i></i>{GAMES[id].shortName}
        </button>
      {/each}
    </div>
    <div class="chips">
      {#each KINDS as k (k)}
        <button class="chip kind" class:on={kinds.has(k)} onclick={() => (kinds = toggle(kinds, k))}>{KIND_LABEL[k]}</button>
      {/each}
    </div>
  </div>

  <div class="month">
    <button onclick={() => move(-1)} aria-label="지난달">◀</button>
    <strong>{month.y}년 {month.m + 1}월</strong>
    <button onclick={() => move(1)} aria-label="다음 달">▶</button>
  </div>

  <div class="grid">
    {#each ["일", "월", "화", "수", "목", "금", "토"] as w, i (w)}<span class="wd" class:sun={i === 0} class:sat={i === 6}>{w}</span>{/each}
    {#each cells as c (c.day)}
      {@const mk = marks(c.day)}
      <button class="cell" class:out={!c.inMonth} class:today={c.day === dayOf(now)} class:picked={c.day === picked} onclick={() => (picked = c.day)}>
        <span class="dn" class:edge={mk.edge} class:ver={mk.version}>{new Date(c.day).getDate()}</span>
        <span class="dots">{#each mk.games as g (g)}<i style:background={COLOR[g]}></i>{/each}</span>
      </button>
    {/each}
  </div>

  <div class="day">
    <div class="dtitle">
      <strong>{pickedText}</strong>
      <button class="small" onclick={openAdd}>＋ 내 일정</button>
    </div>
    {#if adding}
      <form class="add card" onsubmit={(e) => { e.preventDefault(); saveMine(); }}>
        <input placeholder="일정 이름 (예: 콜라보 카페)" bind:value={draft.title} aria-label="일정 이름" />
        <div class="arow">
          <input type="date" bind:value={draft.start} aria-label="시작일" />
          <span>~</span>
          <input type="date" bind:value={draft.end} aria-label="끝나는 날 (없으면 하루)" />
        </div>
        <div class="arow">
          <select bind:value={draft.game} aria-label="게임">
            <option value="">게임 없음</option>
            {#each GAME_IDS as id (id)}<option value={id}>{GAMES[id].shortName}</option>{/each}
          </select>
          <span class="sp"></span>
          <button type="submit" class="save" disabled={!draft.title.trim() || !draft.start}>저장</button>
          <button type="button" onclick={() => (adding = false)}>취소</button>
        </div>
      </form>
    {/if}
    {#if !dayItems.length}
      <p class="muted none">이날 일정이 없습니다.</p>
    {/if}
    {#each dayItems as it (it.id)}
      {@const edge = edgeOn(it, picked)}
      <div class="item" style:--c={COLOR[it.game ?? "none"]}>
        <div class="irow">
          <span class="tag">{it.game ? GAMES[it.game].shortName : "내 일정"}</span>
          {#if it.kind !== "mine" || it.game}<span class="kind">{KIND_LABEL[it.kind]}</span>{/if}
          {#if edge === "start" || edge === "both"}<span class="edge s">시작</span>{/if}
          {#if edge === "end" || edge === "both"}<span class="edge e">종료</span>{/if}
          <span class="d">{dText(it, now)}</span>
        </div>
        <div class="ititle">
          {#if it.url}<a href={it.url} target="_blank" rel="noopener noreferrer">{it.title}</a>{:else}{it.title}{/if}
        </div>
        <div class="imeta">
          <span>{periodText(it)}{it.approx ? " (일부 추정)" : ""}</span>
          {#if it.kind === "mine"}<button class="x" onclick={() => removeMine(it.id)} aria-label="내 일정 지우기">지우기</button>{/if}
        </div>
      </div>
    {/each}
  </div>
</section>

<style>
  .cal { display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
  .chead { display: flex; align-items: center; gap: 8px; }
  .chead strong { flex: 1; font-size: 15px; }
  .small { font-size: 12px; padding: 3px 10px; }
  .close { padding: 2px 8px; }
  .filters { display: flex; flex-direction: column; gap: 6px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; padding: 4px 10px; opacity: 0.55; }
  .chip i { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
  .chip.on { opacity: 1; border-color: var(--c, var(--top)); font-weight: 700; }
  .chip.kind.on { border-color: var(--top); }
  .month { display: flex; align-items: center; justify-content: space-between; }
  .month button { padding: 4px 14px; }
  .month strong { font-size: 15px; }
  .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
  .wd { text-align: center; font-size: 11px; color: var(--muted); padding: 2px 0; }
  .wd.sun { color: #ff8a7a; }
  .wd.sat { color: #7fb4ff; }
  .cell { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 5px 0 6px; min-height: 46px; border-radius: 8px; background: var(--panel); border: 1px solid transparent; }
  .cell.out { opacity: 0.4; }
  .cell.today .dn { color: var(--top); font-weight: 800; }
  .cell.picked { border-color: var(--top); }
  .dn { font-size: 13px; font-variant-numeric: tabular-nums; }
  .dn.edge { text-decoration: underline; text-underline-offset: 3px; }
  .dn.ver { background: var(--top); color: #1a1408; border-radius: 6px; padding: 0 4px; text-decoration: none; }
  .dots { display: flex; gap: 2px; min-height: 6px; }
  .dots i { width: 6px; height: 6px; border-radius: 50%; }
  .day { display: flex; flex-direction: column; gap: 6px; }
  .dtitle { display: flex; align-items: center; justify-content: space-between; }
  .none { margin: 4px 0; }
  .item { border-left: 4px solid var(--c); background: var(--panel); border-radius: 8px; padding: 7px 10px; display: flex; flex-direction: column; gap: 3px; }
  .irow { display: flex; align-items: center; gap: 6px; font-size: 11px; }
  .tag { font-weight: 700; color: var(--c); }
  .kind { color: var(--muted); }
  .edge { font-weight: 700; padding: 0 5px; border-radius: 4px; }
  .edge.s { background: color-mix(in srgb, var(--good) 25%, transparent); color: var(--good); }
  .edge.e { background: color-mix(in srgb, #ff8a7a 25%, transparent); color: #ff8a7a; }
  .d { margin-left: auto; color: var(--muted); }
  .ititle { font-size: 14px; font-weight: 600; word-break: keep-all; line-height: 1.35; }
  .ititle a { color: inherit; text-decoration: underline; text-underline-offset: 3px; }
  .imeta { display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: var(--muted); }
  .x { font-size: 11px; padding: 1px 8px; }
  .add { display: flex; flex-direction: column; gap: 6px; padding: 8px; }
  .arow { display: flex; align-items: center; gap: 6px; }
  .arow input { flex: 1; min-width: 0; }
  .sp { flex: 1; }
  .save { font-weight: 700; }
</style>
