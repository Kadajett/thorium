import {
  orderedUnique,
  PENDING_FENCE,
  type PresentHistory,
  type PresentRecord,
} from "./presentation-types.mts";

interface CpuRangeState {
  readonly logicalCount: number;
  readonly previousEnd: number;
}

function validCpuRange(first: number, last: number): boolean {
  return (
    Number.isSafeInteger(first) && Number.isSafeInteger(last) && last >= first && last <= 65535
  );
}

function parseRange(part: string): Readonly<{ first: number; last: number }> {
  const [firstText, lastText = firstText] = part.split("-");
  const first = Number(firstText);
  const last = Number(lastText);
  if (!validCpuRange(first, last)) {
    throw new Error("Invalid present-CPU range");
  }
  return { first, last };
}

function countRange(state: CpuRangeState, part: string): CpuRangeState {
  const { first, last } = parseRange(part);
  if (first <= state.previousEnd) throw new Error("Invalid present-CPU range");
  return { logicalCount: state.logicalCount + last - first + 1, previousEnd: last };
}

export function parseCpuPresent(
  output: string,
): Readonly<{ present: string; logicalCount: number }> {
  const present = output.trim();
  if (present.length > 4096 || !/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(present)) {
    throw new Error("Invalid present-CPU list");
  }
  const state = present.split(",").reduce(countRange, { logicalCount: 0, previousEnd: -1 });
  return { present, logicalCount: state.logicalCount };
}

function activeProviderFields(output: string): readonly string[] | null {
  return /^Current WebView package \(name, version\): \(([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+), ([A-Za-z0-9][A-Za-z0-9.+_-]{0,127})\)$/.exec(
    output.trim(),
  );
}

export function parseCurrentWebViewPackage(
  output: string,
): Readonly<{ packageName: string; versionName: string }> {
  const fields = activeProviderFields(output);
  return { packageName: providerField(fields, 1), versionName: providerField(fields, 2) };
}

function providerField(fields: readonly string[] | null, index: number): string {
  const value = fields?.[index];
  if (value === undefined) throw new Error("Active WebView package/version unavailable or invalid");
  return value;
}

function parseTimestamp(value: string | undefined): bigint {
  if (value === undefined || !/^\d+$/.test(value)) throw new Error("Invalid frame-history row");
  return BigInt(value);
}

function parseRecord(line: string): PresentRecord {
  const fields: readonly string[] = line.trim().split(/\s+/);
  if (fields.length !== 3) throw new Error("Invalid frame-history row");
  return [parseTimestamp(fields[0]), parseTimestamp(fields[1]), parseTimestamp(fields[2])];
}

function refreshPeriod(line: string | undefined): bigint {
  if (line === undefined || !/^\d+$/.test(line)) throw new Error("Missing display refresh period");
  const value = BigInt(line);
  if (value <= 0n) throw new Error("Invalid display refresh period");
  return value;
}

export function parsePresentHistory(output: string): PresentHistory {
  const lines: readonly string[] = output.trim().split(/\r?\n/);
  const refreshPeriodNs = refreshPeriod(lines[0]);
  const records: readonly PresentRecord[] = lines.slice(1).map(parseRecord);
  const timestamps = orderedUnique(
    records.map((row) => row[1]).filter((time) => time > 0n && time < PENDING_FENCE),
  );
  return { refreshPeriodNs, timestamps, records };
}
