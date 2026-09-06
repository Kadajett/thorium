export type CdpRecord = Readonly<Record<string, unknown>>;
export interface CdpPort {
  readonly call: (method: string, params?: CdpRecord) => Promise<CdpRecord>;
  readonly close: () => void;
}
interface Pending {
  readonly resolve: (value: CdpRecord) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}
function record(value: unknown): CdpRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid CDP object");
  }
  return value as CdpRecord;
}
function settle(pending: Map<number, Pending>, raw: unknown): void {
  if (typeof raw !== "string") return;
  const parsed: unknown = JSON.parse(raw);
  const message = record(parsed);
  if (typeof message.id !== "number") return;
  const request = pending.get(message.id);
  if (request === undefined) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error !== undefined) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(record(message.result));
}
function rejectPending(pending: Map<number, Pending>, error: Error): void {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pending.clear();
}
async function opened(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("CDP open timeout"));
    }, 5000);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("CDP open failed"));
      },
      { once: true },
    );
  });
}
function request(
  socket: WebSocket,
  pending: Map<number, Pending>,
  payload: CdpRecord,
): Promise<CdpRecord> {
  const id = payload.id;
  if (typeof id !== "number") throw new Error("Invalid CDP request id");
  return new Promise<CdpRecord>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("CDP request timeout"));
    }, 5000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify(payload));
  });
}
export async function connectCdp(url: string): Promise<CdpPort> {
  const socket = new WebSocket(url);
  const pending = new Map<number, Pending>();
  let sequence = 0;
  socket.addEventListener("message", (event) => {
    try {
      settle(pending, event.data);
    } catch {
      rejectPending(pending, new Error("Invalid CDP response"));
    }
  });
  socket.addEventListener("close", () => {
    rejectPending(pending, new Error("CDP closed"));
  });
  await opened(socket);
  return {
    call: (method, params = {}) => request(socket, pending, { id: ++sequence, method, params }),
    close: () => {
      socket.close();
    },
  };
}
