import type { ThoriumGameHostContext } from "@thorium/game-host-api";

function unexpectedOperation(): Promise<never> {
  return Promise.reject(
    new Error("The load-only probe must not perform admission or registry effects"),
  );
}

export const probeAdmission: ThoriumGameHostContext["admission"] = {
  verifyPlatform: unexpectedOperation,
  consumePlatform: unexpectedOperation,
  issueTransfer: unexpectedOperation,
  verifyTransfer: unexpectedOperation,
  consumeTransfer: unexpectedOperation,
};

export const probeRegistry: ThoriumGameHostContext["registry"] = {
  admit: unexpectedOperation,
  isActive: unexpectedOperation,
  finish: unexpectedOperation,
};
