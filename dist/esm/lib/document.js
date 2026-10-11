import { ObjectId } from 'mongodb';
import { copyValue } from './values.js';
let DocumentCodec = class DocumentCodec {
    id(value) {
        if (this.manual) {
            if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Manual Mongo id must be a string or number');
            return value;
        }
        if (value instanceof ObjectId) return new ObjectId(value.toHexString());
        if (typeof value !== 'string' || !/^[a-fA-F0-9]{24}$/.test(value)) throw new Error('Invalid default Mongo id; expected a 24-hex string');
        return new ObjectId(value);
    }
    findId(value) {
        return {
            [this.idAttribute]: this.id(value)
        };
    }
    attributesToNative(attributes) {
        if (!this.manual && attributes._id !== undefined && !(attributes._id instanceof ObjectId)) throw new Error('Invalid native Mongo _id; expected ObjectId');
        const document = copyValue(attributes);
        if (attributes.id !== undefined && attributes.id !== null) {
            if (this.manual) {
                const id = this.id(attributes.id);
                if (typeof id !== 'string' && typeof id !== 'number') throw new Error('Manual Mongo id conversion did not produce a string or number');
                document.id = id;
            } else {
                const id = this.id(attributes.id);
                if (!(id instanceof ObjectId)) throw new Error('Default Mongo id conversion did not produce ObjectId');
                document._id = id;
                delete document.id;
            }
        }
        return document;
    }
    nativeToAttributes(native) {
        const attributes = copyValue(native);
        if (!this.manual && native._id !== undefined) {
            if (!(native._id instanceof ObjectId)) throw new Error('Default Mongo document has a non-ObjectId _id');
            attributes.id = native._id.toHexString();
        }
        delete attributes._id;
        return attributes;
    }
    constructor(manual){
        this.manual = manual;
        this.idAttribute = manual ? 'id' : '_id';
    }
};
export { DocumentCodec as default };
