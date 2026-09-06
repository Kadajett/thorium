export interface ApkIdentity {
  readonly packageId: string;
  readonly versionCode: number;
  readonly versionName: string;
  readonly minSdk: number;
}
export interface ApkAsset {
  readonly assetName: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}
export interface AndroidUpdateManifest extends ApkIdentity {
  readonly schema: 1;
  readonly apk: ApkAsset;
}
function capture(text: string, pattern: Readonly<RegExp>, label: string): string {
  const value = pattern.exec(text)?.[1];
  if (value === undefined) throw new Error(`Missing APK ${label}`);
  return value;
}
function positiveInteger(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error("Invalid APK integer metadata");
  }
  return value;
}
export function parseApkBadging(badging: string): ApkIdentity {
  const packageLine = capture(badging, /^(package: .+)$/m, "package");
  const packageId = capture(packageLine, / name='([a-z0-9]+(?:\.[a-z0-9]+)+)'/, "package ID");
  const versionCode = Number(capture(packageLine, / versionCode='([0-9]+)'/, "version code"));
  const versionName = capture(packageLine, / versionName='([^'\r\n]{1,128})'/, "version name");
  const minSdk = Number(capture(badging, /^sdkVersion:'([0-9]+)'$/m, "minimum SDK"));
  return {
    packageId,
    versionCode: positiveInteger(versionCode, 2_100_000_000),
    versionName,
    minSdk: positiveInteger(minSdk, 1000),
  };
}
export function updateManifest(identity: ApkIdentity, apk: ApkAsset): AndroidUpdateManifest {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.apk$/.test(apk.assetName)) {
    throw new Error("Invalid APK release asset name");
  }
  if (!/^[a-f0-9]{64}$/.test(apk.sha256)) throw new Error("Invalid APK checksum");
  positiveInteger(apk.sizeBytes, 256 * 1024 * 1024);
  return { schema: 1, ...identity, apk: { ...apk } };
}

export function verifyAndroidReleaseTag(identity: ApkIdentity, tag: string): void {
  const expected = `android-v${identity.versionName.replace(/-debug$/, "")}`;
  if (tag !== expected) throw new Error("Release tag does not match the APK version name");
}
