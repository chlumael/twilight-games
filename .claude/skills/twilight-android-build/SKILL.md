---
name: twilight-android-build
description: 황혼 게임즈 안드로이드 앱(APK)을 빌드하고 검증해서 사용자 휴대폰으로 보낼 때 사용. "APK 줘", "앱 새로 빌드", "휴대폰에 설치할 파일", 안드로이드 코드(android/)나 웹 화면을 고친 뒤 테스트 버전을 전달해야 할 때, 버전 올리기·서명 키 문제·덮어쓰기 설치 실패를 다룰 때 반드시 이 스킬을 따른다.
---

# 안드로이드 APK 빌드·전달

앱 구조: `android/`의 Kotlin 앱이 웹 화면(`src/`, Svelte)을 WebView로 띄운다. 그래서 **웹 화면만 고쳐도 APK를 다시 빌드해야** 휴대폰에 반영된다. 자세한 구조는 `DESIGN.md` §8-1.

## 1. 도구 확인 (세션이 새로 시작됐으면)

```bash
ls /opt/android-sdk/platforms /opt/android-sdk/build-tools 2>/dev/null || echo "SDK 없음"
```

SDK가 없으면 `references/sdk-setup.md`대로 설치한다(수 분 걸림, 백그라운드 실행 권장). Java 21과 Gradle은 기본 설치돼 있다.

## 2. 버전 올리기

사용자에게 새 APK를 줄 때마다 `android/app/build.gradle.kts`의 `versionCode`를 1 올리고 `versionName`을 맞춘다. versionCode가 같거나 낮으면 휴대폰에서 덮어쓰기 설치가 거부된다.

## 3. 빌드

```bash
cd <repo>
npm run build:android                       # 웹 화면 → android/app/src/main/assets/web
cd android && printf "sdk.dir=/opt/android-sdk\n" > local.properties
./gradlew assembleRelease --no-daemon -q    # 첫 빌드는 Gradle 다운로드로 수 분
```

"Kotlin daemon terminated" 메시지는 자동으로 다른 방식으로 컴파일하므로 무시해도 된다. 결과물: `android/app/build/outputs/apk/release/app-release.apk`.

## 4. 검증 (전달 전에 반드시)

```bash
bash .claude/skills/twilight-android-build/scripts/verify_apk.sh android/app/build/outputs/apk/release/app-release.apk
```

패키지명·버전·권한·서명 인증서 SHA-256·웹 파일 포함 여부를 출력한다. 확인할 것:
- 웹 파일(`assets/web/`)이 들어 있는지. 0개면 `npm run build:android`를 빠뜨린 것이다.
- **서명 인증서 SHA-256이 이전 전달본과 같은지.** 다르면 휴대폰에서 덮어쓰기 설치가 안 되고, 지우고 다시 설치하면 기록이 사라진다. 다르면 전달하기 전에 사용자에게 먼저 "백업 내보내기 후 재설치 필요"를 알린다.

## 5. 전달

```bash
cp android/app/build/outputs/apk/release/app-release.apk <scratchpad>/twilight-games-<versionName>.apk
```

SendUserFile(display: attach)로 보내고, 답변에는 다음을 적는다.
- 바뀐 점 (사용자가 체감하는 기능 단위)
- 설치 방법: 파일 받기 → 설치 → (처음이면) 출처를 알 수 없는 앱 허용
- 실기 테스트를 못 한 부분은 못 했다고 명시

> **버전은 사용자가 업데이트하라고 말했을 때만 올린다(2026-11-26).** 그 전에는 버전을 그대로 두고 커밋·푸시만 하며, 바뀐 점은 `android/RELEASE_NOTES.md`의 "다음 업데이트에 들어갈 것"에 모아 둔다.

## 정식 배포: 버전을 올려 푸시하면 자동 게시 (0.3.0부터, 사용자 승인 방식 A)

설치된 앱은 GitHub Releases의 최신 버전을 6시간마다 확인해서 알림·대화상자로 업데이트를 안내한다(`Updater.kt`). 그래서 **새 버전은 이 방식으로 배포하는 것이 기본**이다. 이 세션은 태그를 푸시할 수 없다(403). 사용자가 2026-11-25에 "워크플로가 직접 태그를 만들어 게시"하는 방식을 승인했다.

1~2. 버전 번호와 안내문은 **`twilight-release` 스킬의 `bump_version.py`로** 올린다(안드로이드·PC 번호를 함께 맞추고, 모아 둔 "다음 업데이트" 목록을 새 버전 안내문으로 옮긴다). 손으로 고치지 않는다.
3. 커밋·푸시(작업 브랜치). `.github/workflows/android-release.yml`이 "이 버전의 Release가 아직 없으면" 고정 키로 빌드 → 서명 지문 검사 → 태그 `v<versionName>` 생성 → Release 게시. 이미 게시된 버전이면 아무것도 하지 않는다.
4. 결과는 `twilight-ship`의 CI 확인 방법으로 본다. Secrets가 없으면 "Signing key present" 단계에서 실패한다.
5. 게시가 확인되면 APK를 따로 보낼 필요가 없다. 사용자에게는 "앱에서 업데이트 알림이 뜬다"고 안내한다.

## 서명 키

- 고정 키 지문: `21724c02904a68f70e6fa90d05e9aa03c0978cff848551f080bfe86b4389f0dc` (워크플로가 이 값과 다르면 배포를 막는다)
- CI는 Secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`를 쓴다. 별칭은 `androiddebugkey`(첫 테스트 키를 그대로 고정한 것).
- 세션에서 직접 빌드할 때 키는 `TWILIGHT_KEYSTORE`, `TWILIGHT_KEYSTORE_PASSWORD` 환경 변수로 준다. 키 파일이 세션에 없으면 사용자에게 받거나, 직접 전달 대신 태그 배포를 쓴다.
- 키 없이 빌드하면 세션 디버그 키로 서명돼 **지문이 달라질 수 있다.** 그런 APK는 사용자에게 보내지 않는다.
- 키 파일과 비밀번호는 저장소에 커밋하지 않는다. 자세한 내용은 `references/signing.md`.

## 화면만 빠르게 확인하고 싶을 때

APK 없이 브라우저로 오버레이 모드를 흉내 내서 확인할 수 있다 → `twilight-ui-screens` 스킬.
