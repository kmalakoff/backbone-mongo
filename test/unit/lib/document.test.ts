import assert from 'assert';
import { ObjectId } from 'mongodb';
import DocumentCodec from '../../../src/lib/document.ts';

describe('internal Mongo document codec', () => {
  it('preserves caller input while converting one identity', () => {
    const codec = new DocumentCodec(false);
    const source = { id: '0123456789abcdef01234567', nested: { value: 1 } };
    const native = codec.attributesToNative(source);
    assert.ok(native._id instanceof ObjectId);
    assert.deepStrictEqual(source, { id: '0123456789abcdef01234567', nested: { value: 1 } });
    assert.notStrictEqual(native.nested, source.nested);
    assert.deepStrictEqual(codec.nativeToAttributes(native), source);
    assert.throws(() => codec.id('abcdefghijkl'), /Invalid default Mongo id/);
    assert.throws(() => codec.id(0), /Invalid default Mongo id/);
    assert.throws(() => codec.attributesToNative({ _id: 'bad' }), /Invalid native Mongo _id/);
  });
  it('preserves manual zero and string ids', () => {
    const codec = new DocumentCodec(true);
    assert.deepStrictEqual(codec.findId(0), { id: 0 });
    assert.deepStrictEqual(codec.nativeToAttributes({ _id: new ObjectId(), id: 0 }), { id: 0 });
    assert.strictEqual(codec.id('manual'), 'manual');
  });
});
