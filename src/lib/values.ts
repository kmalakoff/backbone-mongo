export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function copyValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copyValue) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Buffer.isBuffer(value)) return Buffer.from(value) as T;
  if (isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copyValue(entry)])) as T;
  }
  return value;
}

export function stringList(value: unknown, label: string): string[] {
  const values: unknown[] = Array.isArray(value) ? value : [value];
  if (!values.every((entry): entry is string => typeof entry === 'string')) throw new Error(`${label} requires strings`);
  return values;
}

export function nonnegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} requires a nonnegative integer`);
  return value;
}
