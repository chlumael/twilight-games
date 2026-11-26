// 눌러야 나오는 화면(입력 폼, 배너 자세히, 특정 탭 등)을 순서대로 눌러 가며 찍는다.
// Usage: node flow.cjs <flow.json> <outDir> [baseUrl]
// flow.json:
// {
//   "mode": "mobile",                 // mobile(기본) | desktop | overlay | app
//   "game": "endfield",               // 처음 열 게임
//   "games": {                        // 시험 기록(없는 게임은 빈 기록). sample-data.json의 games와 같은 형식
//     "endfield": { "currency": {...}, "currentBanner": {...}, "baseline": {...},
//       "sessions": [{ "group": "endfield-chartered", "banner": "", "count": 40, "minsAgo": 30, "tops": { "39": ["명하", false] } }] }
//   },
//   "steps": [
//     { "tab": "한정" },                       // 글자가 들어간 첫 버튼 누르기(배너 종류 탭 등)
//     { "click": "button.addbtn" },            // 선택자로 누르기
//     { "check": "label.exch:has-text('긴급 모집') input" },
//     { "fill": ["form.add input.n", "52"] },
//     { "shot": "form", "at": "form.add" },    // 찍기. at이 있으면 그 부분이 보이게 스크롤한 뒤 화면 전체를 찍는다
//     { "shot": "detail", "only": "section.detail" },  // only = 그 부분만 잘라 찍기
//     { "wait": 300 }
//   ],
//   "sheet": "result"                 // 있으면 찍은 것을 한 장(<outDir>/<sheet>-sheet.png)으로 묶는다
// }
const { chromium, devices } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const [flowFile, outDir = ".", base = "http://localhost:4175/twilight-games/"] = process.argv.slice(2);
if (!flowFile) { console.error("usage: node flow.cjs <flow.json> <outDir> [baseUrl]"); process.exit(2); }
const flow = JSON.parse(fs.readFileSync(flowFile, "utf8"));
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "sample-data.json"), "utf8"));
const NAMES = { genshin: "원신", arknights: "명방", endfield: "엔드필드", limbus: "림버스" };

function buildRecords() {
  const now = Date.now();
  const games = {};
  for (const id of Object.keys(NAMES)) {
    const g = (flow.games ?? {})[id] ?? {};
    const pulls = [];
    for (const [k, s] of (g.sessions ?? []).entries()) {
      for (let i = 0; i < s.count; i++) {
        const top = (s.tops ?? {})[String(i)];
        pulls.push({
          id: `${id}-${k}-${i}`, time: new Date(now - (s.minsAgo ?? 0) * 60000 + i * 1000).toISOString(), game: id,
          group: s.group, banner: s.banner ?? "", sessionId: `${id}-${k}-${Math.floor(i / 10)}`, indexInSession: i % 10,
          top: !!top, name: top ? top[0] : null, featured: top ? top[1] : null,
          source: "manual", confidence: 1, status: "confirmed",
        });
      }
    }
    games[id] = { pulls, currency: g.currency ?? {}, currencyUpdatedAt: null, baseline: g.baseline ?? {}, currentBanner: g.currentBanner ?? {} };
  }
  return { schemaVersion: 1, games, undo: [] };
}

const contexts = {
  desktop: { viewport: { width: 360, height: 620 }, deviceScaleFactor: 2 },
  mobile: { ...devices["Pixel 7"] },
  overlay: { viewport: { width: 340, height: 530 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true },
  app: { ...devices["Pixel 7"] },
};

(async () => {
  const mode = flow.mode ?? "mobile";
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
  for (let i = 0; i < 30; i++) {
    try { await page.goto(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  const game = flow.game ?? "genshin";
  await page.evaluate(([r, s]) => {
    localStorage.setItem("tg-records", JSON.stringify(r));
    localStorage.setItem("tg-settings", JSON.stringify(s));
  }, [buildRecords(), { ...seed.settings, lastGame: game }]);
  await page.reload();
  await page.waitForTimeout(900);
  if (mode === "desktop" && (await page.locator("button.expand").count())) await page.click("button.expand");
  if (await page.locator("nav.games").count()) await page.click(`nav.games button:has-text("${NAMES[game]}")`);
  else if (await page.locator("header select").count()) await page.selectOption("header select", game);
  await page.waitForTimeout(300);

  const shots = [];
  for (const [n, step] of (flow.steps ?? []).entries()) {
    try {
      if (step.tab) await page.locator(`button:has-text("${step.tab}")`).first().click();
      else if (step.click) await page.locator(step.click).first().click();
      else if (step.check) await page.locator(step.check).first().check();
      else if (step.fill) await page.locator(step.fill[0]).first().fill(String(step.fill[1]));
      else if (step.wait) await page.waitForTimeout(step.wait);
      else if (step.shot) {
        const file = path.join(outDir, `${step.shot}.png`);
        if (step.only) await page.locator(step.only).first().screenshot({ path: file });
        else {
          if (step.at) await page.locator(step.at).first().scrollIntoViewIfNeeded();
          await page.screenshot({ path: file });
        }
        shots.push(file);
      }
      if (!step.wait) await page.waitForTimeout(250);
    } catch (e) {
      console.error(`step ${n} 실패: ${JSON.stringify(step)}\n  ${String(e.message).split("\n")[0]}`);
      await page.screenshot({ path: path.join(outDir, `failed-step-${n}.png`) });
      await browser.close();
      process.exit(1);
    }
  }
  await browser.close();
  if (flow.sheet && shots.length) {
    const sheet = path.join(outDir, `${flow.sheet}-sheet.png`);
    execFileSync("python3", ["-I", path.join(__dirname, "sheet.py"), sheet, ...shots], { stdio: "inherit" });
  }
  console.log(`saved ${shots.length} shots to ${outDir}`, errors.length ? `\nconsole errors:\n${errors.join("\n")}` : "\nconsole errors: none");
})();
