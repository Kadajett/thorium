import type { LocalSavePort } from "./local-save-types.js";
import { initialSaveState, transitionSave, type LocalSaveState } from "./core/local-save-state.js";
import { createSavePort } from "./local-save-port.js";
/** One device-local namespace per package; closing a session does not erase it. */
export function createMemoryLocalSaveStore(): {
  readonly open: (packageId: string) => LocalSavePort;
} {
  const packages = new Map<string, LocalSaveState>();
  return {
    open(packageId) {
      return createSavePort((command) =>
        Promise.resolve().then(() => {
          const next = transitionSave(packages.get(packageId) ?? initialSaveState(), command);
          packages.set(packageId, next.state);
          return next.result;
        }),
      );
    },
  };
}
