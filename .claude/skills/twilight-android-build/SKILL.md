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

## 서명 키 (현재 상태와 다음 할 일)

지금은 디버그 키(`~/.android/debug.keystore`)로 서명한다. 클라우드 세션이 바뀌면 이 키가 새로 만들어져 SHA-256이 달라진다. 고정 키로 옮기는 작업(로드맵 M2)은 `references/signing.md`를 따른다. 키 파일과 비밀번호는 저장소에 커밋하지 않는다.

## 화면만 빠르게 확인하고 싶을 때

APK 없이 브라우저로 오버레이 모드를 흉내 내서 확인할 수 있다 → `twilight-ui-screens` 스킬.
