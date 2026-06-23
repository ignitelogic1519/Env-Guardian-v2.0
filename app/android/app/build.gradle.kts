plugins {
    id("com.android.application")
    id("kotlin-android")
    id("dev.flutter.flutter-gradle-plugin")
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
        applicationId = "com.example.env_guardian"
        
        // Setting the foundation firmly at API 21
        minSdk = flutter.minSdkVersion 
        targetSdk = 36
        
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // In .kts, we must use 'is' for these boolean properties
            isMinifyEnabled = false
            isShrinkResources = false
            
            signingConfig = signingConfigs.getByName("debug")
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