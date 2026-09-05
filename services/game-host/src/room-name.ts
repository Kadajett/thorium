import { sha256 } from "./canonical-json.js";
import type { ExactGameRelease } from "@thorium/game-host-api";

const LOCAL_ROOM_NAME = /^[a-z][a-z0-9_]{0,47}$/;

export function physicalRoomName(release: ExactGameRelease, localRoomName: string): string {
  if (!LOCAL_ROOM_NAME.test(localRoomName)) throw new Error("invalid_local_room_name");
  const scope = [
    release.packageId,
    release.version,
    release.contentDigest,
    localRoomName,
  ].join("\0");
  return `g_${sha256(scope).slice(0, 32)}`;
}
