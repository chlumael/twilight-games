#!/usr/bin/env python3
"""버전을 올리고, 모아 둔 '다음 업데이트' 목록을 새 버전 안내문으로 옮긴다.

사용법 (저장소 맨 위에서):
  python3 -I .claude/skills/twilight-release/scripts/bump_version.py            # 마지막 숫자 +1 (0.9.11 → 0.9.12)
  python3 -I .claude/skills/twilight-release/scripts/bump_version.py 0.9.20     # 번호 지정
  python3 -I .claude/skills/twilight-release/scripts/bump_version.py --dry-run  # 바꾸지 않고 무엇이 바뀌는지만

바꾸는 파일: android/app/build.gradle.kts(versionName, versionCode +1), src-tauri/tauri.conf.json,
src-tauri/Cargo.toml, src-tauri/Cargo.lock(twilight-games 항목), android/RELEASE_NOTES.md.
"""
import re
import sys
from pathlib import Path

args = [a for a in sys.argv[1:] if a != "--dry-run"]
dry = "--dry-run" in sys.argv[1:]
root = Path.cwd()
gradle = root / "android/app/build.gradle.kts"
if not gradle.exists():
    sys.exit("저장소 맨 위에서 실행하세요 (android/app/build.gradle.kts 없음)")

g = gradle.read_text()
old = re.search(r'versionName = "([^"]+)"', g).group(1)
code = int(re.search(r"versionCode = (\d+)", g).group(1))
if args:
    new = args[0]
else:
    parts = old.split(".")
    new = ".".join(parts[:-1] + [str(int(parts[-1]) + 1)])
num = lambda v: [int(x) for x in v.split(".")]
if not re.fullmatch(r"\d+\.\d+\.\d+", new) or num(new) <= num(old):
    sys.exit(f"새 버전 {new}이(가) 지금 버전 {old}보다 커야 합니다")
if not new.startswith("0.9."):
    sys.exit("정식 배포 전까지는 0.9.x에서 마지막 숫자만 올립니다 (CLAUDE.md 버전 번호 절)")

changes = {}
changes[gradle] = g.replace(f'versionName = "{old}"', f'versionName = "{new}"').replace(f"versionCode = {code}", f"versionCode = {code + 1}")

conf = root / "src-tauri/tauri.conf.json"
c = conf.read_text()
assert f'"version": "{old}"' in c, "tauri.conf.json의 버전이 안드로이드와 다릅니다"
changes[conf] = c.replace(f'"version": "{old}"', f'"version": "{new}"', 1)

toml = root / "src-tauri/Cargo.toml"
t = toml.read_text()
assert f'name = "twilight-games"\nversion = "{old}"' in t, "Cargo.toml의 버전이 안드로이드와 다릅니다"
changes[toml] = t.replace(f'name = "twilight-games"\nversion = "{old}"', f'name = "twilight-games"\nversion = "{new}"', 1)

lock = root / "src-tauri/Cargo.lock"
if lock.exists():
    l = lock.read_text()
    if f'name = "twilight-games"\nversion = "{old}"' in l:
        changes[lock] = l.replace(f'name = "twilight-games"\nversion = "{old}"', f'name = "twilight-games"\nversion = "{new}"', 1)

notes = root / "android/RELEASE_NOTES.md"
n = notes.read_text()
m = re.match(r"<!--[^\n]*\n(.*?)-->\n", n, re.S)
items = [x for x in (m.group(1).splitlines() if m else []) if x.strip()]
if not items:
    sys.exit("RELEASE_NOTES.md 맨 위 '다음 업데이트' 주석에 항목이 없습니다. 올릴 내용이 있는지 먼저 확인하세요")
head = "<!-- 다음 업데이트에 들어갈 것 (버전을 올릴 때 이 주석을 지우고 새 버전 제목 아래로 옮긴다)\n-->\n"
changes[notes] = head + f"## {new}\n\n" + "\n".join(items) + "\n\n" + n[m.end():]

print(f"{old} → {new} (versionCode {code} → {code + 1})")
print(f"안내문 항목 {len(items)}개:")
for x in items:
    print("  " + x[:100])
if dry:
    print("(--dry-run: 파일은 바꾸지 않았습니다)")
else:
    for p, text in changes.items():
        p.write_text(text)
    print("바꾼 파일:", ", ".join(str(p.relative_to(root)) for p in changes))
    print("다음: 안내문 문장을 사용자가 읽기 좋게 다듬고(앱에 그대로 보임) → npm test && npm run check → 커밋·푸시")
