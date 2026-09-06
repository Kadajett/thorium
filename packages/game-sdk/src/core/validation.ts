export type UnknownRecord = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function record(value: unknown, message: string): UnknownRecord {
  if (!isRecord(value)) throw new TypeError(message);
  return value;
}

export function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

export function array(value: unknown, message: string): readonly unknown[] {
  if (!isArray(value)) throw new TypeError(message);
  return value;
}

export function text(value: unknown, message: string): string {
  if (typeof value !== "string") throw new TypeError(message);
  return value;
}

export function finite(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(message);
  return value;
}

export function integer(value: unknown, range: readonly [number, number], message: string): number {
  const number = bounded(value, range, message);
  if (!Number.isInteger(number)) throw new TypeError(message);
  return number;
}

export function inRange(value: number, [minimum, maximum]: readonly [number, number]): boolean {
  return value >= minimum && value <= maximum;
}

export function bounded(value: unknown, range: readonly [number, number], message: string): number {
  const number = finite(value, message);
  if (!inRange(number, range)) throw new TypeError(message);
  return number;
}

export function positive(value: unknown, message: string): number {
  const number = finite(value, message);
  if (number <= 0) throw new TypeError(message);
  return number;
}

export function matchingText(value: unknown, pattern: Readonly<RegExp>, message: string): string {
  const result = text(value, message);
  if (!pattern.test(result)) throw new TypeError(message);
  return result;
}

export function choice<T extends string | number>(
  value: unknown,
  values: readonly T[],
  message: string,
): T {
  return required(
    values.find((candidate) => candidate === value),
    message,
  );
}

export function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new TypeError(message);
  return value;
}

export function boolean(value: unknown, message: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(message);
  return value;
}

export function unique<T>(values: readonly T[], message: string): readonly T[] {
  if (new Set(values).size !== values.length) throw new TypeError(message);
  return values;
}
