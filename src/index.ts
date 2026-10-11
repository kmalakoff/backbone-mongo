import BackboneORM from 'backbone-orm';
import underscore from 'underscore';
import { isRecord } from './lib/values.ts';
import sync, { configureConnections } from './sync.ts';
import type { MongoConfigureOptions } from './types.ts';

export const Backbone = BackboneORM.Backbone;
export const _ = underscore;

if (!isRecord(BackboneORM.modules)) throw new Error('backbone-orm modules must be an object');
export const modules: Record<string, unknown> = { ...BackboneORM.modules, 'backbone-orm': BackboneORM };

export function configure(options: MongoConfigureOptions): void {
  const { connection_options, ...ormOptions } = options;
  if (connection_options) configureConnections(connection_options);
  BackboneORM.configure(ormOptions);
}

export type * from './types.ts';
export { sync };

const BackboneMongo = { _, Backbone, configure, modules, sync };
export default BackboneMongo;
