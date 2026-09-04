export interface TicketNonceStore {
  consumeOnce(nonce: string, expiresAt: Date, now: Date): Promise<boolean>;
}
