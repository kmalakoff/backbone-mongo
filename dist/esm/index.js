import BackboneORM from 'backbone-orm';
import underscore from 'underscore';
import { isRecord } from './lib/values.js';
import sync, { configureConnections } from './sync.js';
export const Backbone = BackboneORM.Backbone;
export const _ = underscore;
if (!isRecord(BackboneORM.modules)) throw new Error('backbone-orm modules must be an object');
export const modules = {
    ...BackboneORM.modules,
    'backbone-orm': BackboneORM
};
export function configure(options) {
    const { connection_options, ...ormOptions } = options;
    if (connection_options) configureConnections(connection_options);
    BackboneORM.configure(ormOptions);
}
export { sync };
const BackboneMongo = {
    _,
    Backbone,
    configure,
    modules,
    sync
};
export default BackboneMongo;
