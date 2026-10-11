import underscore from 'underscore';
import sync from './sync.js';
import type { MongoConfigureOptions } from './types.js';
export declare const Backbone: typeof import("backbone");
export declare const _: underscore.UnderscoreStatic;
export declare const modules: Record<string, unknown>;
export declare function configure(options: MongoConfigureOptions): void;
export type * from './types.js';
export { sync };
declare const BackboneMongo: {
    _: underscore.UnderscoreStatic;
    Backbone: typeof import("backbone");
    configure: typeof configure;
    modules: Record<string, unknown>;
    sync: import("./types.js").MongoSyncFactory;
};
export default BackboneMongo;
