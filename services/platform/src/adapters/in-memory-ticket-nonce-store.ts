import type { TicketNonceStore } from "../ports/ticket-nonce-store.js";

export class InMemoryTicketNonceStore implements TicketNonceStore {
  readonly #consumed = new Map<string, number>();

  async consumeOnce(nonce: string, expiresAt: Date, now: Date): Promise<boolean> {
    const nowMs = now.getTime();
    if (expiresAt.getTime() <= nowMs) {
      return false;
    }
    for (const [existingNonce, expirationMs] of this.#consumed) {
      if (expirationMs <= nowMs) {
        this.#consumed.delete(existingNonce);
      }
    }

    if (this.#consumed.has(nonce)) {
      return false;
    }
    this.#consumed.set(nonce, expiresAt.getTime());
    return true;
  }
}
