// Screenshot the built web UI in each mode with seed data.
// Usage: node screens.cjs <mode> <outDir> [baseUrl] [dataJson]
//   mode: desktop (360x620 overlay window) | collapsed (360x44) | mobile (Pixel 7 web app)
//         | overlay (Android floating window, bridge emulated) | app (Android app screen)
// Needs a running `vite preview` (see SKILL.md). Uses the preinstalled Playwright.
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");

const [mode = "mobile", outDir = ".", base = "http://localhost:4175/twilight-games/", dataFile = path.join(__dirname, "sample-data.json")] =
  process.argv.slice(2);
const seed = JSON.parse(fs.readFileSync(dataFile, "utf8"));

function buildRecords() {
  const now = Date.now();
  const games = {};
  for (const [id, g] of Object.entries(seed.games)) {
    const pulls = [];
    for (const s of g.sessions) {
      for (let i = 0; i < s.count; i++) {
        const top = s.tops[String(i)];
        pulls.push({
          id: `${id}-${s.minsAgo}-${i}`, time: new Date(now - s.minsAgo * 60000).toISOString(), game: id,
          group: s.group, banner: s.banner, sessionId: `${id}-${s.minsAgo}`, indexInSession: i,
          top: !!top, name: top ? top[0] : null, featured: top ? top[1] : null,
          source: "manual", confidence: 1, status: "confirmed",
        });
      }
    }
    games[id] = { pulls, currency: g.currency, currencyUpdatedAt: null, baseline: g.baseline, currentBanner: g.currentBanner };
  }
  return { schemaVersion: 1, games, undo: [] };
}

const contexts = {
  desktop: { viewport: { width: 360, height: 620 }, deviceScaleFactor: 2 },
  collapsed: { viewport: { width: 360, height: 44 }, deviceScaleFactor: 2 },
  mobile: { ...devices["Pixel 7"] },
  overlay: { viewport: { width: 340, height: 530 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true },
  app: { ...devices["Pixel 7"] },
};

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext(contexts[mode]);
  if (mode === "overlay" || mode === "app") {
    await ctx.addInitScript((m) => {
      window.TwilightAndroid = { mode: () => m, startOverlay() {}, collapse() {}, closeOverlay() {}, saveFile() {} };
    }, mode);
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(m.text()));
  page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  for (let i = 0; i < 30; i++) {
    try { await page.goto(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  await page.evaluate(([r, s]) => {
    localStorage.setItem("tg-records", JSON.stringify(r));
    localStorage.setItem("tg-settings", JSON.stringify(s));
  }, [buildRecords(), seed.settings]);
  await page.reload();
  await page.waitForTimeout(700);

  const shot = (name) => page.screenshot({ path: path.join(outDir, `${mode}-${name}.png`) });
  const names = { genshin: "원신", arknights: "명방", endfield: "엔드필드", limbus: "림버스" };
  const pick = async (id) => {
    if (await page.locator("nav.games").count()) await page.click(`nav.games button:has-text("${names[id]}")`);
    else if (await page.locator("header select").count()) await page.selectOption("header select", id);
    await page.waitForTimeout(300);
  };

  if (mode === "collapsed") {
    await shot("genshin");
  } else {
    if (mode === "desktop" && (await page.locator("button.expand").count())) await page.click("button.expand");
    for (const id of Object.keys(names)) {
      await pick(id); await shot(id);
      // 배너 상세 보기(있을 때만): 펼쳐서 전체 화면을 찍고 다시 접는다
      if (await page.locator("button.binfo").count()) {
        await page.click("button.binfo"); await page.waitForTimeout(200);
        await page.locator("section.detail").evaluate((el) => el.scrollIntoView({ block: "start" }));
        await page.locator("section.detail").screenshot({ path: path.join(outDir, `${mode}-${id}-banner.png`) });
        await page.click("button.binfo");
      }
    }
    await pick("genshin");
    // 예측 패널(펼친 모습)
    if (await page.locator("section.forecast button.head").count()) {
      await page.click("section.forecast button.head"); await page.waitForTimeout(200);
      await page.locator("section.forecast").screenshot({ path: path.join(outDir, `${mode}-forecast.png`) });
      await page.click("section.forecast button.head");
    }
    await page.click("[aria-label=설정]"); await page.waitForTimeout(200); await shot("settings");
    await page.click("[aria-label=설정]");
    // 통계 화면: 내용 전체를 찍는다
    if (await page.locator("button[title=통계]").count()) {
      await page.click("button[title=통계]"); await page.waitForTimeout(200);
      await page.locator("section.stats").screenshot({ path: path.join(outDir, `${mode}-stats.png`) });
      await page.click("button[title=통계]");
    }
  }
  console.log(`saved ${mode} screenshots to ${outDir}`, errors.length ? `\nconsole errors:\n${errors.join("\n")}` : "");
  await browser.close();
})();
