import assert from "node:assert/strict";
import test from "node:test";
import { parseApkBadging, updateManifest, verifyAndroidReleaseTag } from "./core/manifest.mts";

const badging =
  "package: name='dev.yougotserved.thorium.debug' versionCode='10' versionName='0.1.0-dev.10-debug'\nsdkVersion:'29'\ntargetSdkVersion:'37'\n";
const asset = { assetName: "thorium-developer-debug.apk", sizeBytes: 1234, sha256: "a".repeat(64) };

await test("update metadata describes actual APK identity without supplying an arbitrary URL", () => {
  const manifest = updateManifest(parseApkBadging(badging), asset);
  assert.deepEqual(manifest, {
    schema: 1,
    packageId: "dev.yougotserved.thorium.debug",
    versionCode: 10,
    versionName: "0.1.0-dev.10-debug",
    minSdk: 29,
    apk: asset,
  });
  assert.equal("url" in manifest.apk, false);
});

await test("malformed or incomplete APK identities fail before publishing metadata", () => {
  for (const input of [
    "",
    badging.replace("sdkVersion:'29'", ""),
    badging.replace("versionCode='10'", "versionCode='0'"),
  ]) {
    assert.throws(() => parseApkBadging(input));
  }
});

await test("version code is an integer rather than a lexicographic version name", () => {
  assert.equal(
    parseApkBadging(badging.replace("versionCode='10'", "versionCode='100'")).versionCode,
    100,
  );
  assert.throws(() =>
    parseApkBadging(badging.replace("versionCode='10'", "versionCode='9007199254740992'")),
  );
});

await test("asset names, sizes and checksums cannot smuggle alternative download destinations", () => {
  const identity = parseApkBadging(badging);
  for (const assetName of ["../other.apk", "https://other.test/app.apk", "other.zip"]) {
    assert.throws(() => updateManifest(identity, { ...asset, assetName }));
  }
  assert.throws(() => updateManifest(identity, { ...asset, sizeBytes: 0 }));
  assert.throws(() => updateManifest(identity, { ...asset, sha256: "invalid" }));
});

await test("APK byte limits accept the boundary and reject oversized or fractional values", () => {
  const identity = parseApkBadging(badging);
  const maximum = 256 * 1024 * 1024;
  assert.equal(updateManifest(identity, { ...asset, sizeBytes: maximum }).apk.sizeBytes, maximum);
  for (const sizeBytes of [maximum + 1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => updateManifest(identity, { ...asset, sizeBytes }));
  }
});

await test("APK identity rejects non-integer version codes and unsupported SDK metadata", () => {
  for (const versionCode of ["-1", "1.5", "1e3", "2100000001"]) {
    assert.throws(() =>
      parseApkBadging(badging.replace("versionCode='10'", `versionCode='${versionCode}'`)),
    );
  }
  for (const minSdk of ["0", "1001", "Q", "29.5"]) {
    assert.throws(() =>
      parseApkBadging(badging.replace("sdkVersion:'29'", `sdkVersion:'${minSdk}'`)),
    );
  }
});

await test("published release tag must match the actual APK rather than a stale build label", () => {
  const identity = parseApkBadging(badging);
  verifyAndroidReleaseTag(identity, "android-v0.1.0-dev.10");
  for (const tag of ["", "android-v0.1.0-dev.9", "android-v0.1.0-dev.10-debug", "v0.1.0-dev.10"]) {
    assert.throws(() => {
      verifyAndroidReleaseTag(identity, tag);
    });
  }
});
