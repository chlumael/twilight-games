---
name: twilight-ship
description: 황혼 게임즈 작업을 마무리해서 저장소에 올리고 확인할 때 사용. 커밋·푸시, GitHub Actions(CI·Pages·배너) 결과 확인, PR·main 합치기 안내, 웹앱 배포 확인, 작업 끝에 사용자에게 보고할 때 반드시 이 스킬의 순서와 보고 형식을 따른다.
---

# 마무리·배포

## 올리기 전 확인

```bash
npm test && npm run check          # 둘 다 통과해야 함
npm run build && npm run build:web # 데스크톱/웹 빌드
cargo check --manifest-path src-tauri/Cargo.toml   # Rust를 고쳤을 때 (리눅스 의존성 필요 시 libwebkit2gtk-4.1-dev 등 설치)
```

## 커밋·푸시

- 작업 브랜치에서 한다(현재 `phase1-foundation`). `main`에 직접 푸시하지 않는다.
- **자동 합치기(2026-11-25 사용자 승인)**: 작업 브랜치에 올리면 `auto-merge.yml`이 테스트·타입 검사 통과 후 main에 합치고 웹앱 배포를 실행한다. 사용자에게 PR 합치기를 부탁할 필요가 없다.
  - 예외: `.github/workflows/` 파일이 바뀐 푸시는 GitHub 기본 토큰이 올릴 수 없어 건너뛴다(경고만 남음). **워크플로를 고쳤을 때만** 사용자에게 PR 합치기를 부탁하고, 합쳐진 뒤에는 다시 자동으로 돈다.
  - main과 충돌하면 실패한다 → 작업 브랜치에 main을 병합해 풀고 다시 올린다.
- 커밋 메시지는 **한국어**로: 제목 한 줄 + 무엇이 왜 바뀌었는지 본문, 끝에 세션이 지정한 attribution 줄.
- `git -c push.negotiate=true push`

## CI 확인

`gh api`가 된다(`gh run list`·`gh release list` 같은 명령은 GraphQL이 막혀 안 된다). 푸시한 커밋의 작업이 모두 끝날 때까지 기다렸다가 결과를 본다. 보통 3~6분.

```bash
for i in 1 2 3 4 5 6 7; do
  out=$(gh api "repos/chlumael/twilight-games/actions/runs?head_sha=$(git rev-parse HEAD)&per_page=20" --jq '.workflow_runs[] | "\(.name) \(.status) \(.conclusion)"' 2>&1)
  if [ -n "$out" ] && ! echo "$out" | grep -q -E "in_progress|queued|pending|waiting"; then break; fi
  timeout 60 tail -f /dev/null
done; echo "$out"
```

`pages`, `build`, `android-release`, `auto-merge` 네 개가 `completed success`여야 한다. 실패하면 `gh api repos/chlumael/twilight-games/actions/runs/<id>/jobs`에서 실패한 단계를 찾아 고치고 다시 올린다. 실패를 숨기지 않고 보고한다.

배너 데이터를 고쳤으면 main에 실제로 올라갔는지도 본다: `curl -s https://raw.githubusercontent.com/chlumael/twilight-games/main/data/banners.json | python3 -I -c "import json,sys; d=json.load(sys.stdin); print(d['generatedAt'])"`.

## 사용자가 직접 해야 하는 것 (휴대폰으로 가능)

이 세션은 GitHub 설정을 바꿀 수 없다. 필요할 때 링크와 함께 안내한다.
- 브랜치 합치기: `https://github.com/chlumael/twilight-games/compare/main...<branch>?expand=1` → Create pull request → Merge
- Pages 켜기: Settings → Pages → Source: GitHub Actions → 웹앱 주소 `https://chlumael.github.io/twilight-games/`
- 배너 PR 허용: Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests"

이미 안내한 설정을 사용자가 했는지 모르면, API로 확인할 수 있는 것은 확인한다(예: Pages 주소 `curl -o /dev/null -w '%{http_code}'`).

## 보고 형식 (한국어)

사용자 선호: 결론 먼저, 확인한 것과 추정을 구분, 표 활용, 군더더기 없이.
1. 무엇이 끝났는지 한두 문장
2. 바뀐 점 표 (사용자가 체감하는 단위)
3. 검증한 것과 **못 한 것**(실기기 테스트 등)
4. 사용자가 해야 할 것 (있을 때만)
5. 결정이 필요한 질문 (있을 때만)

- **버전 올리기는 사용자가 업데이트를 하라고 했을 때만**(2026-11-26). 평소에는 버전을 그대로 두고 올린다. 보고할 때 "다음 업데이트에 포함"이라고 적는다.
- 고친 내용을 쌓아 두는 법과 게시 순서는 `twilight-release`, 진행 문서 갱신은 `twilight-progress-doc`.
