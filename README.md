# BackboneMongo

MongoDB storage for BackboneORM, with revision-conditioned writes to detect stale model updates.

This checkout is a development candidate for flat models using MongoDB driver 7.7.0. It is not a published upgrade. The adapter-only Node baseline is provisionally 20.19.0 or newer; this does not change BackboneORM's runtime requirements. A running MongoDB server is required.

## Flat models

Use the package root in TypeScript or native ESM. CommonJS uses `require('backbone-mongo')`.

```ts
import Mongo from 'backbone-mongo';

class Item extends Mongo.Backbone.Model {
  urlRoot = 'mongodb://127.0.0.1:27017/example/items';
}
Item.prototype.sync = Mongo.sync(Item);

const item = new Item({ name: 'alpha' });
item.save(null, {
  success(model) {
    console.log(model.id, model.get('_rev')); // 24-hex id and revision 1
  },
  error(_model, error) {
    console.error(error);
  },
});
```

Model `save`, `fetch`, and `destroy` complete through Backbone callbacks and return `undefined`. Do not await `model.save()` as completion evidence. Use the callback to sequence a subsequent operation.

The final URL segment identifies the collection. `/database/collection` selects an explicit database; `/collection` uses the driver's default database. Connection syntax, including SRV and host lists, is interpreted by the Mongo driver parser. The local service tests do not establish live SRV, replica-set or authentication coverage.

Default models store `_id: ObjectId` and expose `id` as a 24-hex string. Manual IDs use the ORM schema's `manual` or `manual_id` marker and preserve string or number IDs, including zero. Manual IDs have no implicit unique index in this slice. Caller attributes and query objects are not modified by conversion.

Creates return `_rev: 1`. Updates atomically match the current ID and revision, increment the revision, and return the stored document. A stale update fails without changing the document. Pending unsets survive failed writes for a retry on the same model instance.

Flat equality, ID lookup, sort, projection, offset/limit, count, exists, one-result and page queries are implemented. Empty collection reads return `[]`; missing one-result queries return `null`; fetching a missing model reports an error. Relations, includes, predicate operators, indexes, schema reset, batch destruction, transactions and migration APIs are not implemented in this candidate.

## Connection ownership

Compatible models share one MongoClient through BackboneORM's public ConnectionPool. Conflicting options are rejected. Connection keys are opaque hashes rather than credential-bearing URLs. Adapter connection release keeps sibling models usable and closes the final owned client once. External clients inserted with `ConnectionPool.set` remain borrowed and are the caller's responsibility to close and remove.

The public model `db()` control exposes `connection.collection(callback)` and `connection.destroy()`, with an optional callback for destruction. Final release waits for adapter-owned operations. It does not track operations performed directly on a native collection returned to a caller.

Deletion removes native documents before ORM cleanup. A later cleanup failure cannot roll back that deletion. This candidate provides no transaction or cross-model atomicity guarantee.

## Contributor checks

Use the locked local tsds tooling. The current local dependency manifest references an accepted private ORM artifact, so this checkout is not a clean-clone bootstrap. Install hooks are disabled in the local verification workflow.

Ordinary tests discover native root export checks, package-name behavior tests, internal document/URI tests and a dual tsds consumer/owner type gate with an invalid sentinel. The real-service fixture requires the reviewed MongoDB 8.2.6 macOS ARM64 binary cache under `.tmp/cache/mongodb-binaries`; it starts only a private loopback server with a private database directory and awaits process cleanup. It does not use a shared Mongo service. Other hosts and cold-cache provisioning remain unverified.

On this coordinated development machine, every build or test must use the assigned exclusive slot and the existing FAMILY `scripts/test-safe.ts` resource wrapper. A refusal stops execution without retries or raised limits. The underlying house commands are `npm run build`, `tsds validate`, and `npm test`.

[MIT license](LICENSE)
