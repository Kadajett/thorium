import { HostClient } from "./host.js";
import {
  SurfaceRole,
  playerSlot,
  type FrameDriver,
  type GameBootstrap,
  type HostInboundMessage,
  type HostOutboundMessage,
  type HostTransport,
  type PlayerSlot,
} from "./types.js";

export interface AccountSessionFixture {
  /** Host-only test identity; it is intentionally removed from each WebView bootstrap. */
  readonly accountSessionId: string;
  readonly playerSlots: readonly PlayerSlot[];
}

class MemoryTransport implements HostTransport {
  readonly #bootstrap: GameBootstrap;
  readonly #listeners = new Set<(message: HostInboundMessage) => void>();
  peer?: MemoryTransport;

  constructor(bootstrap: GameBootstrap) {
    this.#bootstrap = bootstrap;
  }

  async readBootstrap(): Promise<GameBootstrap> {
    return this.#bootstrap;
  }

  send(message: HostOutboundMessage): void {
    if (!this.peer) return;
    if (message.kind === "control") {
      this.peer.deliver({ kind: "control", event: message.event });
    } else if (message.kind === "peer") {
      this.peer.deliver({
        kind: "peer",
        event: { channel: message.channel, payload: message.payload, source: message.source },
      });
    }
  }

  subscribe(listener: (message: HostInboundMessage) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  deliver(message: HostInboundMessage): void {
    for (const listener of this.#listeners) listener(message);
  }
}

export interface TestDevice {
  readonly main: HostClient;
  readonly companion: HostClient;
  /** Available only to the host-side test, never to game code. */
  readonly accountSessions: readonly AccountSessionFixture[];
}

export function createTestDevice(options: {
  readonly gameId: string;
  readonly accountSessions: readonly AccountSessionFixture[];
  readonly controls: GameBootstrap["controls"];
}): TestDevice {
  const slots = options.accountSessions.flatMap((account) => account.playerSlots);
  if (new Set(slots).size !== slots.length) throw new Error("Each PlayerSlot must have one owner");
  const players = slots.map((slot) => ({ slot, displayName: `Player ${slot + 1}`, local: true }));
  const shared = {
    protocolVersion: 1 as const,
    game: { id: options.gameId, version: "0.0.0-test", instanceId: "test-instance" },
    players,
    controls: options.controls,
    render: { logicalWidth: 960, logicalHeight: 540, maximumDevicePixelRatio: 1 },
    limits: { maxLocalPeerMessageBytes: 4096 },
  };
  const mainBootstrap: GameBootstrap = {
    ...shared,
    surface: SurfaceRole.Main,
    controlledPlayerSlots: slots.includes(playerSlot(0)) ? [playerSlot(0)] : [],
  };
  const companionBootstrap: GameBootstrap = {
    ...shared,
    surface: SurfaceRole.Companion,
    controlledPlayerSlots: slots.includes(playerSlot(1)) ? [playerSlot(1)] : [],
  };
  const mainTransport = new MemoryTransport(mainBootstrap);
  const companionTransport = new MemoryTransport(companionBootstrap);
  mainTransport.peer = companionTransport;
  companionTransport.peer = mainTransport;
  return {
    main: new HostClient(mainBootstrap, mainTransport),
    companion: new HostClient(companionBootstrap, companionTransport),
    accountSessions: options.accountSessions,
  };
}

export class ManualFrameDriver implements FrameDriver {
  #nextHandle = 1;
  #callback: ((nowMs: number) => void) | undefined;

  request(callback: (nowMs: number) => void): number {
    this.#callback = callback;
    return this.#nextHandle++;
  }

  cancel(): void {
    this.#callback = undefined;
  }

  advance(nowMs: number): void {
    const callback = this.#callback;
    if (!callback) throw new Error("No frame is scheduled");
    this.#callback = undefined;
    callback(nowMs);
  }
}

export const twoPlayersOneAccount: readonly AccountSessionFixture[] = [
  {
    accountSessionId: "account-session:test-only",
    playerSlots: [playerSlot(0), playerSlot(1)],
  },
];
