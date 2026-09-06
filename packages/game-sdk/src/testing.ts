import { HostClient } from "./host.js";
import { playerSlot, type FrameDriver, type PlayerSlot } from "./types.js";
import { testBootstrap, type TestDeviceOptions } from "./core/test-bootstrap.js";
import { createMemoryTransport } from "./memory-transport.js";
export interface AccountSessionFixture {
  /** Host-only test identity; it is intentionally removed from each WebView bootstrap. */
  readonly accountSessionId: string;
  readonly playerSlots: readonly PlayerSlot[];
}
export interface TestDevice {
  readonly main: HostClient;
  readonly companion: HostClient;
  /** Available only to the host-side test, never to game code. */
  readonly accountSessions: readonly AccountSessionFixture[];
}
export function createTestDevice(options: TestDeviceOptions): TestDevice {
  const main = testBootstrap(options, "main"),
    companion = testBootstrap(options, "companion");
  const upper = createMemoryTransport(main),
    lower = createMemoryTransport(companion);
  upper.connect(lower.deliver);
  lower.connect(upper.deliver);
  return {
    main: new HostClient(main, upper.transport),
    companion: new HostClient(companion, lower.transport),
    accountSessions: options.accountSessions,
  };
}
export interface ManualFrames extends FrameDriver {
  readonly advance: (nowMs: number) => void;
}
export function createManualFrameDriver(): ManualFrames {
  let nextHandle = 1;
  let callback: ((nowMs: number) => void) | undefined;
  return {
    request(next) {
      callback = next;
      return nextHandle++;
    },
    cancel() {
      callback = undefined;
    },
    advance(nowMs) {
      const scheduled = callback;
      if (scheduled === undefined) throw new Error("No frame is scheduled");
      callback = undefined;
      scheduled(nowMs);
    },
  };
}
/** Compatibility facade for existing SDK tests and authors. */
export class ManualFrameDriver implements FrameDriver {
  readonly #driver = createManualFrameDriver();
  request(callback: (nowMs: number) => void): number {
    return this.#driver.request(callback);
  }
  cancel(): void {
    this.#driver.cancel(0);
  }
  advance(nowMs: number): void {
    this.#driver.advance(nowMs);
  }
}
export const twoPlayersOneAccount: readonly AccountSessionFixture[] = [
  { accountSessionId: "account-session:test-only", playerSlots: [playerSlot(0), playerSlot(1)] },
];
