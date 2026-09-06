import { assessHistoryCoverage } from "./presentation-coverage.mts";
import { assessPresentRate } from "./presentation-rate.mts";
import type {
  CoverageResult,
  HistorySnapshot,
  RateOptions,
  RateResult,
} from "./presentation-types.mts";

type Mode = "active" | "static-advisory";

function validMode(value: unknown): value is Mode {
  return value === "active" || value === "static-advisory";
}

function measurementMode(value: unknown): Mode {
  const mode = value ?? "active";
  if (!validMode(mode)) throw new Error("Invalid surface measurement mode");
  return mode;
}

interface SurfacePresentation {
  readonly mode: Mode;
  readonly coverage: CoverageResult;
  readonly observation: RateResult;
  readonly pass: boolean | null;
  readonly reason: string;
}

function decision(
  mode: Mode,
  coverage: CoverageResult,
  observation: RateResult,
): Readonly<{ pass: boolean | null; reason: string }> {
  if (!coverage.pass) return { pass: false, reason: coverage.reason };
  if (mode === "static-advisory") return { pass: null, reason: "static_surface_no_fps_claim" };
  return { pass: observation.pass, reason: observation.reason };
}

export function assessSurfacePresentation(
  snapshots: readonly HistorySnapshot[],
  options: RateOptions & Readonly<{ mode?: Mode }>,
): SurfacePresentation {
  const mode = measurementMode(options.mode);
  const coverage = assessHistoryCoverage(snapshots, options);
  const observation = assessPresentRate(
    snapshots.flatMap((snapshot) => snapshot.history.timestamps),
    options,
  );
  return { mode, coverage, observation, ...decision(mode, coverage, observation) };
}
