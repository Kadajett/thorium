package dev.yougotserved.thorium

import org.json.JSONObject
import org.json.JSONTokener

private val updateDigestPattern = Regex("[0-9a-f]{64}")
private const val UPDATE_VERSION_NAME_LENGTH = 100
private const val UPDATE_MAX_SDK = 1000

internal fun parseAppUpdateManifest(text: String): AppUpdateManifest {
    requireAppUpdate(
        text.toByteArray(Charsets.UTF_8).size <= AppUpdateLimits.METADATA_BYTES, "Update metadata is too large.",
    )
    val tokener = JSONTokener(text)
    val value = tokener.nextValue() as? JSONObject ?: throw AppUpdateException("Invalid update metadata.")
    requireAppUpdate(tokener.nextClean() == '\u0000', "Trailing update metadata.")
    appUpdateFields(value, setOf("schema", "packageId", "versionCode", "versionName", "minSdk", "apk"))
    requireAppUpdate(appUpdateInteger(value, "schema") == 1L, "Unsupported update metadata.")
    return AppUpdateManifest(appUpdateVersion(value), appUpdateSdk(value), appUpdateApk(value.getJSONObject("apk")))
}

internal fun appUpdateFields(value: JSONObject, fields: Set<String>) {
    requireAppUpdate(value.keys().asSequence().toSet() == fields, "Unexpected update metadata fields.")
}

internal fun appUpdateString(value: JSONObject, key: String): String =
    value.get(key) as? String ?: throw AppUpdateException("Invalid update text field.")

internal fun appUpdateInteger(value: JSONObject, key: String): Long {
    val number = value.get(key)
    requireAppUpdate(number is Int || number is Long, "Update number must be an integer.")
    return (number as Number).toLong()
}

private fun appUpdateVersion(value: JSONObject): AppUpdateVersion {
    val packageId = appUpdateString(value, "packageId")
    val code = appUpdateInteger(value, "versionCode")
    val name = appUpdateString(value, "versionName")
    requireAppUpdate(packageId.matches(Regex("[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*){1,15}")), "Invalid update package ID.")
    requireAppUpdate(code in 1..Int.MAX_VALUE.toLong(), "Invalid update version code.")
    val validName = name.length in 1..UPDATE_VERSION_NAME_LENGTH && name.none { it.isISOControl() }
    requireAppUpdate(validName, "Invalid update version name.")
    return AppUpdateVersion(packageId, code, name)
}

private fun appUpdateSdk(value: JSONObject): Int {
    val sdk = appUpdateInteger(value, "minSdk")
    requireAppUpdate(sdk in 1..UPDATE_MAX_SDK, "Invalid update Android requirement.")
    return sdk.toInt()
}

private fun appUpdateApk(value: JSONObject): AppUpdateApk {
    appUpdateFields(value, setOf("assetName", "sizeBytes", "sha256"))
    val name = appUpdateString(value, "assetName")
    val size = appUpdateInteger(value, "sizeBytes")
    val digest = appUpdateString(value, "sha256")
    requireAppUpdate(name == AppUpdateLimits.APK_NAME, "Unexpected APK asset name.")
    requireAppUpdate(size in 1..AppUpdateLimits.APK_BYTES, "Invalid APK size.")
    requireAppUpdate(updateDigestPattern.matches(digest), "Invalid APK checksum.")
    return AppUpdateApk(name, size, digest)
}
