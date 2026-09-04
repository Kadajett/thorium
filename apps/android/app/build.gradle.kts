import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

val catalogBaseUrl = providers.gradleProperty("thoriumCatalogBaseUrl")
    .orElse("https://games.yougotserved.dev")
    .get()
val catalogUri = URI(catalogBaseUrl)
require(
        catalogUri.scheme == "https" && catalogUri.host != null && catalogUri.userInfo == null &&
        catalogUri.rawQuery == null && catalogUri.rawFragment == null &&
        (catalogUri.rawPath.isNullOrEmpty() || catalogUri.rawPath == "/"),
) { "thoriumCatalogBaseUrl must be an absolute HTTPS URL without credentials, query, or fragment" }

android {
    namespace = "dev.yougotserved.thorium"
    compileSdk = 37

    defaultConfig {
        applicationId = "dev.yougotserved.thorium"
        minSdk = 29
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0-dev"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "CATALOG_BASE_URL", "\"${catalogBaseUrl.trimEnd('/')}\"")
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    sourceSets.getByName("main").assets.directories.add(
        "../../../games/tap-race/android-assets",
    )
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.08.00"))
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.core:core-ktx:1.19.0")
    implementation("androidx.webkit:webkit:1.17.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260814")
}
