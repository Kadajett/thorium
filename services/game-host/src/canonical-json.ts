import { createHash } from "node:crypto";
export { canonicalJson } from "./core/canonical-json.js";

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
