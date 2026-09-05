export interface AccountSession {
  readonly accountId: string;
  readonly accountSessionId: string;
  readonly expiresAt: Date;
}

export interface AccountIdentityPort {
  verifyAccountToken(token: string): Promise<AccountSession>;
}

export interface IssuedAccountAuthorization {
  readonly token: string;
  readonly expiresAt: Date;
}

export interface DeviceAccountIdentityPort extends AccountIdentityPort {
  /** Issues an anonymous account session bound to possession of a 256-bit install credential. */
  issueForDeviceCredential(credential: string): Promise<IssuedAccountAuthorization>;
}
