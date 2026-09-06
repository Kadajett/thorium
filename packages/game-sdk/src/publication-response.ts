import { publicationReceipt, type PublicationReceipt } from "./core/publication.js";
const HTTP_ERRORS: Readonly<Record<number, string>> = {
  400: "The server rejected the package or descriptor.",
  401: "The publishing token is invalid or has been rotated.",
  403: "The publisher quota is exhausted.",
  409: "The package belongs to another publisher or this version has different content.",
  413: "The upload exceeds the server limit.",
  422: "This game requires an operator-deployed server module.",
  429: "Publishing is rate limited. Wait before retrying.",
  503: "Publishing is temporarily unavailable.",
};
type Reader = ReadableStreamDefaultReader<Uint8Array>;
async function receiptText(reader: Reader): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks).toString("utf8");
    size += value.byteLength;
    if (size > 16_384) throw new Error("Receipt is too large");
    chunks.push(value);
  }
}
async function receiptInput(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("Empty receipt");
  try {
    const input: unknown = JSON.parse(await receiptText(reader));
    return input;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
async function checkStatus(response: Response): Promise<void> {
  if (response.status === 200 || response.status === 201) return;
  await response.body?.cancel().catch(() => undefined);
  const message =
    HTTP_ERRORS[response.status] ?? "Check the platform and retry the unchanged package.";
  throw new Error(`Publishing failed (HTTP ${String(response.status)}). ${message}`);
}
/** Never include untrusted response bodies: proxies can echo request credentials. */
export async function readPublicationReceipt(
  response: Response,
  expected: PublicationReceipt["release"],
): Promise<PublicationReceipt> {
  await checkStatus(response);
  try {
    return publicationReceipt(await receiptInput(response), expected, response.status);
  } catch {
    throw new Error(
      "The server returned an invalid publication receipt. Check the catalog before retrying the unchanged package.",
    );
  }
}
