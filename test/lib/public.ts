import assert from 'assert';
import type Backbone from 'backbone';
import type { MongoConnectionControl, MongoDocument } from 'backbone-mongo';
import type { Collection } from 'mongodb';

export function call(host: object, name: string, args: readonly unknown[] = []): unknown {
  const method: unknown = Reflect.get(host, name);
  if (typeof method !== 'function') throw new Error(`Missing public method ${name}`);
  return Reflect.apply(method, host, args);
}
export function connection(host: object): MongoConnectionControl {
  const db = call(host, 'db');
  if (typeof db !== 'object' || db === null) throw new Error('Missing public database control');
  const value: unknown = Reflect.get(db, 'connection');
  if (!isConnection(value)) throw new Error('Invalid public Mongo connection');
  return value;
}
function isConnection(value: unknown): value is MongoConnectionControl {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'url') === 'string' && typeof Reflect.get(value, 'collection') === 'function' && typeof Reflect.get(value, 'destroy') === 'function';
}
export function collection(control: MongoConnectionControl): Promise<Collection<MongoDocument>> {
  return new Promise((resolve, reject) =>
    control.collection((error, value) => {
      if (error) reject(error);
      else if (!value) reject(new Error('Missing real Mongo collection'));
      else resolve(value);
    })
  );
}
export function result(invoke: (callback: (error: unknown, value?: unknown) => void) => unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const returned = invoke((error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
    assert.strictEqual(returned, undefined);
  });
}
export function save(model: Backbone.Model, attributes: Backbone.ObjectHash | null = null): Promise<void> {
  return new Promise((resolve, reject) => {
    const returned: unknown = model.save(attributes, { success: () => resolve(), error: (_model, error: unknown) => reject(error) });
    assert.strictEqual(returned, undefined);
  });
}
export function fetch(model: Backbone.Model | Backbone.Collection): Promise<void> {
  return new Promise((resolve, reject) => {
    const returned: unknown = model.fetch({ success: () => resolve(), error: (_model, error: unknown) => reject(error) });
    assert.strictEqual(returned, undefined);
  });
}
