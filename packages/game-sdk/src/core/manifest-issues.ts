import { isRecord } from "./validation.js";
import { budgetIssues, displaysIssues, runtimeFiles, runtimeIssues } from "./manifest-runtime.js";
import { playersIssues } from "./manifest-players.js";
import {
  bindingIssues,
  capabilityIssues,
  controlsIssues,
  descriptionIssues,
  identityIssues,
  multiplayerIssues,
} from "./manifest-rules.js";

/** Pure validation returns every author-facing diagnostic without mutating a collector. */
export function manifestIssues(value: unknown): readonly string[] {
  if (!isRecord(value)) return ["manifest must be an object"];
  return [
    ...identityIssues(value),
    ...descriptionIssues(value),
    ...runtimeIssues(value.runtime),
    ...displaysIssues(value.displays),
    ...playersIssues(value.players),
    ...multiplayerIssues(value.multiplayer),
    ...controlsIssues(value.controls),
    ...bindingIssues(value.controllerBindings, value.controls),
    ...capabilityIssues(value.capabilities, value.multiplayer),
    ...budgetIssues(value.budgets, runtimeFiles(value.runtime)),
  ];
}
