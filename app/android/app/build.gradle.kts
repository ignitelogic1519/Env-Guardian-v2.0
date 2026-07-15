import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    id("dev.flutter.flutter-gradle-plugin")
}

// ── Release signing (required for Play Store uploads) ─────────────────────
// The upload keystore is NEVER committed. Create it once:
//   keytool -genkey -v -keystore ~/eg-upload.jks -keyalg RSA -keysize 2048 \
//           -validity 10000 -alias upload
// then copy android/key.properties.example to android/key.properties and
// fill in the paths/passwords (both files are gitignored).
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

android {
    namespace = "com.example.env_guardian"
    compileSdk = 36
    ndkVersion = flutter.ndkVersion

    compileOptions {
        isCoreLibraryDesugaringEnabled = true 
        
        // UPGRADE THESE TWO LINES TO 17:
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        // Updated to the non-deprecated string format the Shogun prefers
        jvmTarget = "17"
    }

    defaultConfig {
        // Published application id (Play-ready). Kept separate from the Kotlin
        // `namespace` above so source packages / channel names don't have to move.
        applicationId = "com.envguardian.mdm"
        
        // Setting the foundation firmly at API 21
        minSdk = flutter.minSdkVersion 
        targetSdk = 36
        
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (keystorePropertiesFile.exists()) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            // In .kts, we must use 'is' for these boolean properties
            isMinifyEnabled = false
            isShrinkResources = false

            // Real upload key when android/key.properties exists; debug-key
            // fallback ONLY so local `flutter build apk` keeps working without
            // a keystore. Play uploads MUST be built with key.properties in
            // place — a debug-signed bundle is rejected by the Play Console.
            signingConfig = if (keystorePropertiesFile.exists())
                signingConfigs.getByName("release")
            else
                signingConfigs.getByName("debug")
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    // Other dependencies might be here...
    
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.3") // <-- KOTLIN SYNTAX
}