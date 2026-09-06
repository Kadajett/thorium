// Node 24 loads these erasable TypeScript modules directly; preserve existing CLI imports.
export {
  parseCpuPresent,
  parseCurrentWebViewPackage,
  parsePresentHistory,
} from "./core/presentation-parsers.mts";
export { assessHistoryCoverage } from "./core/presentation-coverage.mts";
export { assessPresentRate } from "./core/presentation-rate.mts";
export { assessSurfacePresentation } from "./core/surface-presentation.mts";
