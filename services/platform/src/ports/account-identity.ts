export interface AccountSession {
  readonly accountId: string;
  readonly accountSessionId: string;
  readonly expiresAt: Date;
}

export interface AccountIdentityPort {
  verifyAccountToken(token: string): Promise<AccountSession>;
}
