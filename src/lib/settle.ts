import type { ResultCallback } from 'backbone-orm';

export function operationCallback<T>(operation: () => PromiseLike<T> | T, callback: ResultCallback<T>): void {
  // Notification is outside the Promise chain so a customer throw is not a driver rejection.
  void Promise.resolve()
    .then(operation)
    .then(
      (value) => queueMicrotask(() => callback(null, value)),
      (error: unknown) => queueMicrotask(() => callback(error instanceof Error ? error : new Error('Mongo operation threw a non-Error value')))
    );
}

export function driverError(error: unknown, phase: string): Error {
  // Driver parse/transport messages can contain connection credentials.
  const safe = new Error(`Mongo ${phase} failed`);
  if (typeof error === 'object' && error !== null) {
    const code: unknown = Reflect.get(error, 'code');
    if (typeof code === 'number') Object.defineProperty(safe, 'code', { value: code, enumerable: true });
  }
  return safe;
}
