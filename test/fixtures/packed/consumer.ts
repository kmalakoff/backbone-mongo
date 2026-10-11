import Mongo, { type MongoConnectionControl, type MongoDatabaseControl, type MongoDocument, type MongoSyncOptions } from 'backbone-mongo';
import type { ModelSync } from 'backbone-orm';
import type { Collection } from 'mongodb';

class Item extends Mongo.Backbone.Model {
  urlRoot = 'mongodb://127.0.0.1:27017/packed/items';
}
const options: MongoSyncOptions = { forceServerObjectId: false, appName: 'packed-types', serverSelectionTimeoutMS: 1000 };
const sync: ModelSync = Mongo.sync(Item, options);
Item.prototype.sync = sync;
export function consume(db: MongoDatabaseControl): Promise<void> {
  const control: MongoConnectionControl = db.connection;
  control.collection((error, value) => {
    if (!error && value) {
      const native: Collection<MongoDocument> = value;
      void native.findOne({ _rev: 1 });
    }
  });
  control.destroy((error) => {
    if (error) throw error;
  });
  return control.destroy();
}
