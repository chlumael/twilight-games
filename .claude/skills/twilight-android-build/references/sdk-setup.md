# Android SDK 설치 (클라우드 세션)

dl.google.com, maven.google.com, services.gradle.org는 접속된다.

```bash
export ANDROID_HOME=/opt/android-sdk
mkdir -p $ANDROID_HOME/cmdline-tools && cd /tmp
# 최신 파일 이름 확인
curl -s https://dl.google.com/android/repository/repository2-3.xml | grep -oE 'commandlinetools-linux-[0-9]+_latest\.zip' | sort -u | tail -1
curl -s -o clt.zip https://dl.google.com/android/repository/<위에서 찾은 파일>
unzip -q clt.zip -d $ANDROID_HOME/cmdline-tools && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest
yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"
```

AGP가 build-tools 34를 추가로 요구하면 첫 빌드 때 자동으로 받는다.
빌드 버전: AGP 8.7.3, Kotlin 2.0.21, compileSdk/targetSdk 35, minSdk 26.
