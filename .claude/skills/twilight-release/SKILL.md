---
name: twilight-release
description: 황혼 게임즈의 업데이트를 모아 두거나 새 버전으로 게시할 때 사용. 사용자가 "업데이트해", "올려", "배포해", "버전 올려"라고 했을 때, 고친 내용을 "다음 업데이트"에 쌓아 둘 때, android/RELEASE_NOTES.md를 고칠 때, 게시가 됐는지 확인할 때, "지금 뭐가 업데이트 없이 반영돼?" 같은 질문에 답할 때 반드시 이 스킬을 따른다. 버전 번호를 손으로 고치지 말고 이 스킬의 스크립트를 쓴다.
---

# 업데이트 모으기와 게시

사용자는 업데이트 알림이 자주 뜨는 것을 싫어한다(2026-11-26 지시). 그래서 평소에는 **버전을 그대로 두고** 고친 것을 쌓아 두다가, 사용자가 업데이트하라고 말했을 때만 한 번에 게시한다.

## 평소: 쌓아 두기 (버전 그대로)

1. 코드를 고치고 `npm test && npm run check`.
2. `android/RELEASE_NOTES.md` 맨 위 주석 `<!-- 다음 업데이트에 들어갈 것 … -->` 안에 한 줄 추가한다.
   - 이 줄은 나중에 **앱의 업데이트 안내문으로 그대로 보인다.** 사용자가 읽을 한국어로, 체감하는 변화를 한 줄로 쓴다(파일 이름·함수 이름 금지).
3. 커밋·푸시(`twilight-ship`). 버전이 같으면 새 설치 파일이 게시되지 않아 휴대폰에 알림이 뜨지 않는다.
4. 답변에 "다음 업데이트 때 들어간다"고 적는다.

### 업데이트 없이 바로 반영되는 것 (사용자가 자주 묻는다)

| 구분 | 바로 반영? |
|---|---|
| 배너 데이터 `data/banners.json` (배너 목록·기간·픽업·등급 목록) | 됨. 앱이 main의 파일을 받아 온다 |
| 웹앱 (GitHub Pages) | 됨. 푸시하면 최신 |
| PC 설치 파일 | 같은 버전 번호라도 푸시 때마다 최신 코드로 덮어써진다(새로 받아 설치하면 최신, 알림은 안 감) |
| 그 밖 전부 (화면, 계산 규칙 `games.ts`, 이름 표 `data/names`, 화면 인식 틀 `data/screens`) | 안 됨. 앱 업데이트 필요 |

주의: 배너 데이터에 **새 칸**을 추가해도, 이미 설치된 앱이 그 칸을 읽지 않으면 쓰이지 않는다. 게시된 버전이 읽는지 확인하고 말한다: `git show v<버전>:src/App.svelte | grep <칸 이름>`.

## 사용자가 "업데이트해"라고 했을 때

```bash
python3 -I .claude/skills/twilight-release/scripts/bump_version.py --dry-run   # 무엇이 바뀌는지 먼저 본다
python3 -I .claude/skills/twilight-release/scripts/bump_version.py             # 마지막 숫자 +1
```

스크립트가 하는 일: `android/app/build.gradle.kts`(versionName, versionCode +1), `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`의 번호를 맞추고, 안내문 주석 안의 목록을 `## <새 버전>` 제목 아래로 옮긴 뒤 빈 주석을 다시 만들어 둔다.

- **정식 배포 전까지는 `0.9.x`의 마지막 숫자만 올린다**(0.9.9 → 0.9.10). 스크립트가 다른 번호는 거절한다.
- 주석에 항목이 없으면 스크립트가 멈춘다. 올릴 내용이 정말 없는지 `git log v<지금 버전>..HEAD --oneline`으로 확인한다.

그다음:

1. 옮겨진 안내문을 읽고 다듬는다. 비슷한 항목은 합치고, 사용자가 겪는 순서(큰 변화 먼저)로 놓는다.
2. `npm test && npm run check`, Rust를 고쳤으면 `cargo check`.
3. **게시 전 화면 점검**: 이번 업데이트에서 바뀐 화면을 `twilight-ui-screens`로 찍어 직접 본다. 0.9.11 때 이 단계에서 "직접 입력이 보유 재화를 깎는" 문제를 찾았다.
4. 커밋(제목 예: `0.9.12 게시: …`)·푸시.
5. 게시 확인(아래). 확인되면 진행 문서의 현재 버전 문장·버전 표를 갱신한다(`twilight-progress-doc`).
6. 사용자에게: 휴대폰은 앱에서 업데이트 알림이 뜬다(확인 주기 6시간, 설정에서 바로 확인 가능), PC는 켤 때 알림이 뜬다고 안내한다.

## 게시 확인

`android-release.yml`이 "이 버전의 릴리스가 아직 없으면" APK를 만들어 `v<버전>` 릴리스로 게시하고, `build.yml`의 windows 작업이 PC 설치 파일을 같은 릴리스에 올린다. 보통 10분 안쪽.

```bash
v=$(grep -o 'versionName = "[^"]*"' android/app/build.gradle.kts | cut -d'"' -f2)
gh api "repos/chlumael/twilight-games/releases/tags/v$v" --jq '"\(.tag_name) 자산: \([.assets[].name] | join(","))"'
```

- 자산에 `twilight-games-<버전>.apk`와 `twilight-games-pc-setup.exe` 둘 다 있어야 끝난 것이다.
- `gh release list`는 이 환경에서 막혀 있다(GraphQL 차단). 위처럼 `gh api`를 쓴다.
- 404면 아직 만드는 중이다. 워크플로 상태는 `twilight-ship`의 CI 확인으로 본다. "Signing key present" 단계 실패는 저장소 Secrets 문제라 사용자에게 알린다.
- 이 세션은 태그를 직접 푸시할 수 없다(403). 워크플로가 태그를 만든다.

## 하지 말 것

- 사용자가 말하지 않았는데 버전을 올리지 않는다. 큰 수정이어도 마찬가지다.
- `1.0.0`이나 `0.10.0`으로 넘기지 않는다.
- 이미 게시된 버전 번호로 내용을 바꿔 다시 게시하려 하지 않는다(휴대폰 쪽은 아무 일도 일어나지 않는다).
