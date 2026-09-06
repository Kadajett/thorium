import type { JsonValue } from "./types.js";
export interface LocalSaveGrant {
  readonly protocolVersion: 1;
  readonly maxValueBytes: number;
  readonly maxKeys: number;
  readonly maxTotalBytes: number;
}
export interface LocalSaveEntry {
  readonly revision: number;
  readonly value: JsonValue;
}
export interface LocalSavePort {
  readonly read: (key: string) => Promise<LocalSaveEntry | null>;
  readonly write: (
    key: string,
    value: JsonValue,
    expectedRevision: number | null,
  ) => Promise<number>;
  readonly remove: (key: string, expectedRevision: number) => Promise<void>;
}
export const localSaveErrorCodes = [
  "unsupported",
  "invalid_request",
  "quota_exceeded",
  "conflict",
  "io_error",
  "closed",
  "timeout",
  "busy",
] as const;
export type LocalSaveErrorCode = (typeof localSaveErrorCodes)[number];
export type LocalSaveCommand =
  | { readonly operation: "read"; readonly key: string }
  | {
      readonly operation: "write";
      readonly key: string;
      readonly valueJson: string;
      readonly expectedRevision: number | null;
    }
  | { readonly operation: "remove"; readonly key: string; readonly expectedRevision: number };
export type LocalSaveRequest = LocalSaveCommand & {
  readonly kind: "local-save-request";
  readonly protocolVersion: 1;
  readonly requestId: string;
};
export interface LocalSaveWireEntry {
  readonly revision: number;
  readonly valueJson: string;
}
export type LocalSaveOutcome =
  | { readonly operation: "read"; readonly entry: LocalSaveWireEntry | null }
  | { readonly operation: "write"; readonly revision: number }
  | { readonly operation: "remove" };
export type LocalSaveResponse = {
  readonly kind: "local-save-result";
  readonly protocolVersion: 1;
  readonly requestId: string;
} & (
  | { readonly status: "ok"; readonly result: LocalSaveOutcome }
  | { readonly status: "error"; readonly error: LocalSaveErrorCode }
);
