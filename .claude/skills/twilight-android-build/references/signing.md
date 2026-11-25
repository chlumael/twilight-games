# 서명 키

**상태 (2026-11-25)**: 고정 키 준비 완료. 첫 테스트 APK의 디버그 키를 그대로 `twilight-release.jks`로 만들고 비밀번호만 강하게 바꿨다(PKCS12, 별칭 `androiddebugkey`, 2056년까지 유효). 사용자에게 키 파일과 Secrets 등록용 텍스트를 전달했다. 아래 절차는 키를 새로 만들어야 할 때를 위한 기록이다.

## 고정 서명 키로 옮기기 (참고)

목표: 어느 세션·어느 CI에서 빌드해도 같은 키로 서명해서, 사용자가 항상 덮어쓰기 설치할 수 있게 한다.

## 원칙
- 키 파일(.jks)과 비밀번호는 **저장소에 커밋하지 않는다**. GitHub Secrets에만 둔다.
- 키를 잃으면 기존 설치본을 업데이트할 수 없으니, 사용자가 키 파일을 따로 보관하게 한다.

## 절차
1. 키 생성(사용자 동의 후):
   `keytool -genkeypair -v -keystore release.jks -alias twilight -keyalg RSA -keysize 2048 -validity 10000`
2. 사용자에게 키 파일을 전달하고 보관을 부탁한다.
3. 사용자가 저장소 Settings → Secrets and variables → Actions에 등록:
   - `ANDROID_KEYSTORE_BASE64` (`base64 -w0 release.jks` 결과)
   - `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
4. `android/app/build.gradle.kts`에 환경 변수가 있으면 그 키를 쓰는 `signingConfigs.release` 추가, 없으면 디버그 키로 대체.
5. `.github/workflows/`에 APK 빌드 작업 추가: Secrets → 키 파일 복원 → `npm ci` → `npm run build:android` → `./gradlew assembleRelease` → 아티팩트 또는 GitHub Release 업로드.
6. 디버그 키로 설치된 버전에서 넘어올 때는 서명이 달라서 한 번은 재설치가 필요하다. 사용자에게 먼저 백업 내보내기를 안내한다.

## 전달 기록

| 버전 | 날짜 | 서명 SHA-256 (앞 16자리) | 비고 |
|---|---|---|---|
| 0.1.0 (1) | 2026-11-25 | 21724c02904a68f7 | 세션 디버그 키. 실기 테스트용 첫 전달 |
| 0.1.1 (2) | 2026-11-25 | 21724c02904a68f7 | 접힌 상태를 정보 막대로 변경

새 APK를 보낼 때 이 표에 한 줄 추가한다. 지문이 바뀌면 덮어쓰기 설치가 안 된다.
| 0.2.0 (3) | 2026-11-25 | 21724c02904a68f7 | 고정 키(같은 지문). 자동 업데이트 확인 추가 |
