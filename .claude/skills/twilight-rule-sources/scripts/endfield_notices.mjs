// 엔드필드 한국어 공식 공지(헤드헌팅 공지 전부 + 「확률 상세 안내」)를 글자만 뽑아 파일로 저장한다. 규칙 원문을 읽을 때 쓴다.
// Usage: NODE_USE_ENV_PROXY=1 node endfield_notices.mjs <outDir>     (저장소 맨 위에서 실행)
// 결과: <outDir>/<공지번호>.txt (첫 줄 = 제목, 둘째 줄 = 게시 시각). 「확률 상세 안내」가 규칙이 가장 자세하다.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const out = process.argv[2];
if (!out) { console.error("usage: node endfield_notices.mjs <outDir>"); process.exit(2); }
const { plainText } = await import(pathToFileURL(path.resolve("scripts/banners/endfield-official.mjs")).href);
const API = "https://web-news.gryphline.com/api/bulletin";
const Q = "lang=ko-kr&code=arknights_endfield_official";
const get = async (u) => (await (await fetch(u, { headers: { "User-Agent": "banner-pack" } })).json()).data;
fs.mkdirSync(out, { recursive: true });
const notices = [];
for (let p = 1; p <= 20; p++) {
  const d = await get(`${API}?${Q}&page=${p}&pageSize=50&tabs[]=notices`);
  notices.push(...d.list);
  if (!d.list.length || notices.length >= d.total) break;
}
for (const n of notices.filter((n) => n.title?.includes("헤드헌팅") || n.title?.trim() === "확률 상세 안내")) {
  const d = await get(`${API}/${n.cid}?${Q}`);
  const when = new Date(d.displayTime * 1000).toISOString();
  fs.writeFileSync(path.join(out, `${n.cid}.txt`), `${n.title}\n${when}\n\n${plainText(d.data)}`);
  console.log(n.cid, when.slice(0, 10), n.title);
}
