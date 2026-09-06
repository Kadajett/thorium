import { record, choice, text } from "./validation.js";
export interface PublicationReceipt {
  readonly status: "published" | "already-published";
  readonly release: {
    readonly packageId: string;
    readonly version: string;
    readonly contentDigest: string;
  };
}
type Release = PublicationReceipt["release"];
type Origin = Readonly<
  Pick<URL, "protocol" | "pathname" | "username" | "password" | "search" | "hash" | "origin">
>;
function parseOrigin(input: string): Origin {
  try {
    return new URL(input);
  } catch {
    throw new Error("The platform URL must be an HTTPS origin.");
  }
}
export function publisherEndpoint(input: string): string {
  const endpoint = parseOrigin(input);
  const invalid = endpoint.protocol !== "https:" || endpoint.pathname !== "/";
  const credentials = endpoint.username !== "" || endpoint.password !== "";
  if (invalid || credentials || endpoint.search !== "" || endpoint.hash !== "")
    throw new Error("The platform URL must be an HTTPS origin without credentials or a path.");
  return endpoint.origin + "/v1/publisher/releases";
}
export function checkPublishToken(token: string): void {
  if (!/^thp_[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error("Set THORIUM_PUBLISH_TOKEN to the scoped token from /v1/publishers/token.");
}
export function checkPublishSize(descriptorBytes: number, archiveBytes: number): void {
  if (descriptorBytes > 1024 * 1024 || archiveBytes > 90 * 1024 * 1024)
    throw new Error("Publishing allows a descriptor up to 1 MiB and an archive up to 90 MiB.");
}
function releaseOf(input: unknown): Release {
  const value = record(input, "Invalid release");
  return {
    packageId: text(value.packageId, "Invalid package ID"),
    version: text(value.version, "Invalid version"),
    contentDigest: text(value.contentDigest, "Invalid digest"),
  };
}
export function publicationReceipt(
  input: unknown,
  expected: Release,
  status: number,
): PublicationReceipt {
  const value = record(input, "Invalid receipt");
  const release = releaseOf(value.release);
  if (
    release.packageId !== expected.packageId ||
    release.version !== expected.version ||
    release.contentDigest !== expected.contentDigest
  )
    throw new Error("Receipt does not match package");
  return {
    status: choice(
      value.status,
      [status === 201 ? "published" : "already-published"],
      "Invalid status",
    ),
    release,
  };
}
