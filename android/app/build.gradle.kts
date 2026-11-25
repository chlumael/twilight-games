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
        versionCode = 3
        versionName = "0.2.0"
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
}
