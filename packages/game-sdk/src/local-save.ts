import type { HostInboundMessage, HostTransport } from "./types.js";
import type {
  LocalSaveCommand,
  LocalSaveGrant,
  LocalSaveOutcome,
  LocalSavePort,
  LocalSaveResponse,
} from "./local-save-types.js";
import { parseLocalSaveGrant, parseLocalSaveResponse } from "./core/local-save-wire.js";
import { saveBytes } from "./core/local-save-value.js";
import { LocalSaveError, localSaveError } from "./local-save-errors.js";
import { createSavePort } from "./local-save-port.js";
export { LocalSaveError } from "./local-save-errors.js";
export type {
  LocalSavePort,
  LocalSaveEntry,
  LocalSaveGrant,
  LocalSaveErrorCode,
} from "./local-save-types.js";
interface Pending {
  readonly operation: LocalSaveCommand["operation"];
  readonly resolve: (result: LocalSaveOutcome) => void;
  readonly reject: (error: LocalSaveError) => void;
  readonly cancel: () => void;
}
export interface LocalSaveEnvironment {
  readonly id: () => string;
  readonly schedule: (callback: () => void, milliseconds: number) => () => void;
}
const defaultEnvironment: LocalSaveEnvironment = {
  id: () => crypto.randomUUID(),
  schedule(callback, milliseconds) {
    const timer = setTimeout(callback, milliseconds);
    return () => {
      clearTimeout(timer);
    };
  },
};
interface Client {
  readonly transport: HostTransport;
  readonly grant: LocalSaveGrant;
  readonly environment: LocalSaveEnvironment;
  readonly pending: Map<string, Pending>;
  closed: boolean;
}
function expire(client: Client, id: string): void {
  const request = client.pending.get(id);
  if (request === undefined) return;
  client.pending.delete(id);
  request.cancel();
  request.reject(new LocalSaveError("timeout"));
}
function close(client: Client): void {
  client.closed = true;
  for (const request of client.pending.values()) {
    request.cancel();
    request.reject(new LocalSaveError("closed"));
  }
  client.pending.clear();
}
function complete(client: Client, message: LocalSaveResponse): void {
  const request = client.pending.get(message.requestId);
  if (request === undefined) return;
  if (message.status === "ok") checkedResult(client, message.result);
  client.pending.delete(message.requestId);
  request.cancel();
  if (message.status === "error") request.reject(new LocalSaveError(message.error));
  else if (message.result.operation !== request.operation)
    request.reject(new LocalSaveError("invalid_request"));
  else request.resolve(message.result);
}
function checkedResult(client: Client, result: LocalSaveOutcome): LocalSaveOutcome {
  if (
    result.operation === "read" &&
    result.entry !== null &&
    saveBytes(result.entry.valueJson) > client.grant.maxValueBytes
  )
    throw new LocalSaveError("quota_exceeded");
  return result;
}
function receive(client: Client, message: HostInboundMessage): void {
  if (message.kind === "lifecycle" && message.state === "stopped") {
    close(client);
    return;
  }
  if (message.kind !== "local-save-result") return;
  try {
    complete(client, parseLocalSaveResponse(message));
  } catch (error) {
    const request = client.pending.get(message.requestId);
    client.pending.delete(message.requestId);
    request?.cancel();
    request?.reject(localSaveError(error));
  }
}
function checkRequest(client: Client, command: LocalSaveCommand): void {
  if (client.closed) throw new LocalSaveError("closed");
  if (client.pending.size >= 4) throw new LocalSaveError("busy");
  if (command.operation === "write" && saveBytes(command.valueJson) > client.grant.maxValueBytes)
    throw new LocalSaveError("quota_exceeded");
}
function send(client: Client, command: LocalSaveCommand): Promise<LocalSaveOutcome> {
  checkRequest(client, command);
  const requestId = client.environment.id();
  if (client.pending.has(requestId)) throw new LocalSaveError("busy");
  return new Promise((resolve, reject) => {
    dispatch(client, command, { requestId, resolve, reject });
  });
}
function dispatch(
  client: Client,
  command: LocalSaveCommand,
  request: {
    readonly requestId: string;
    readonly resolve: Pending["resolve"];
    readonly reject: Pending["reject"];
  },
): void {
  const { requestId, resolve, reject } = request;
  const cancel = client.environment.schedule(() => {
    expire(client, requestId);
  }, 5000);
  client.pending.set(requestId, { operation: command.operation, resolve, reject, cancel });
  try {
    client.transport.send({
      ...command,
      kind: "local-save-request",
      protocolVersion: 1,
      requestId,
    });
  } catch (error) {
    cancel();
    client.pending.delete(requestId);
    reject(localSaveError(error));
  }
}
export function createLocalSaveClient(
  transport: HostTransport,
  grant?: LocalSaveGrant,
  environment: LocalSaveEnvironment = defaultEnvironment,
): LocalSavePort {
  if (grant === undefined)
    return createSavePort(() => Promise.reject(new LocalSaveError("unsupported")));
  const client: Client = {
    transport,
    grant: parseLocalSaveGrant(grant),
    environment,
    pending: new Map(),
    closed: false,
  };
  transport.subscribe((message) => {
    receive(client, message);
  });
  return createSavePort((command) => send(client, command));
}
