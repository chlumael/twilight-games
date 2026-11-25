plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing comes from the environment (GitHub Secrets in CI, a local file
// in a dev session). Without it the build falls back to the debug key.
val releaseKeystore = System.getenv("TWILIGHT_KEYSTORE")?.let { file(it) }?.takeIf { it.exists() }

android {
    namespace = "io.github.chlumael.twilightgames"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.chlumael.twilightgames"
        minSdk = 26 // TYPE_APPLICATION_OVERLAY
        targetSdk = 35
        versionCode = 10
        versionName = "0.4.0"
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = releaseKeystore
                storePassword = System.getenv("TWILIGHT_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("TWILIGHT_KEY_ALIAS") ?: "androiddebugkey"
                keyPassword = System.getenv("TWILIGHT_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }
    buildFeatures {
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.webkit:webkit:1.12.1")
    // Native Google sign-in for the tracker account (Google blocks it inside WebViews).
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    // 화면 읽기: 기기 안에서 도는 한국어 글자 인식. 모델을 앱에 넣는 방식은 APK가 3MB → 47MB로
    // 커져서, 구글 플레이 서비스가 모델을 한 번 내려받아 두는 방식을 쓴다(인식은 기기 안에서 한다).
    implementation("com.google.android.gms:play-services-mlkit-text-recognition-korean:16.0.1")
}
