import '../../../exports/import.test.ts';
import '../../../unit/lib/document.test.ts';
import '../../../unit/lib/target.test.ts';
import '../../../integration/mongoPackage.test.ts';
import '../../../integration/packedConsumers.test.ts';
import '../../../fixtures/callbackThrows.ts';
import '../run.test.ts';
import Mongo, { type MongoConnectionControl, type MongoSyncOptions } from 'backbone-mongo';
import type { ModelSync } from 'backbone-orm';

class TypedItem extends Mongo.Backbone.Model {
  urlRoot = 'mongodb://127.0.0.1:27017/docs/items';
}
const options: MongoSyncOptions = { appName: 'typed-consumer', serverSelectionTimeoutMS: 1000, forceServerObjectId: false };
const sync: ModelSync = Mongo.sync(TypedItem, options);
TypedItem.prototype.sync = sync;
function consume(control: MongoConnectionControl): Promise<void> {
  control.collection((error, native) => {
    if (!error && native) void native.findOne({ _rev: 1 });
  });
  control.destroy((error) => {
    if (error) throw error;
  });
  return control.destroy();
}
void consume;
