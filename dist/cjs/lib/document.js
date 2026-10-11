"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return DocumentCodec;
    }
});
var _mongodb = require("mongodb");
var _valuests = require("./values.js");
function _class_call_check(instance, Constructor) {
    if (!(instance instanceof Constructor)) throw new TypeError("Cannot call a class as a function");
}
function _define_property(obj, key, value) {
    if (key in obj) {
        Object.defineProperty(obj, key, {
            value: value,
            enumerable: true,
            configurable: true,
            writable: true
        });
    } else obj[key] = value;
    return obj;
}
function _instanceof(left, right) {
    "@swc/helpers - instanceof";
    if (right != null && typeof Symbol !== "undefined" && right[Symbol.hasInstance]) {
        return !!right[Symbol.hasInstance](left);
    } else return left instanceof right;
}
var DocumentCodec = /*#__PURE__*/ function() {
    "use strict";
    function DocumentCodec(manual) {
        _class_call_check(this, DocumentCodec);
        this.manual = manual;
        this.idAttribute = manual ? 'id' : '_id';
    }
    var _proto = DocumentCodec.prototype;
    _proto.id = function id(value) {
        if (this.manual) {
            if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Manual Mongo id must be a string or number');
            return value;
        }
        if (_instanceof(value, _mongodb.ObjectId)) return new _mongodb.ObjectId(value.toHexString());
        if (typeof value !== 'string' || !/^[a-fA-F0-9]{24}$/.test(value)) throw new Error('Invalid default Mongo id; expected a 24-hex string');
        return new _mongodb.ObjectId(value);
    };
    _proto.findId = function findId(value) {
        return _define_property({}, this.idAttribute, this.id(value));
    };
    _proto.attributesToNative = function attributesToNative(attributes) {
        if (!this.manual && attributes._id !== undefined && !_instanceof(attributes._id, _mongodb.ObjectId)) throw new Error('Invalid native Mongo _id; expected ObjectId');
        var document = (0, _valuests.copyValue)(attributes);
        if (attributes.id !== undefined && attributes.id !== null) {
            if (this.manual) {
                var id = this.id(attributes.id);
                if (typeof id !== 'string' && typeof id !== 'number') throw new Error('Manual Mongo id conversion did not produce a string or number');
                document.id = id;
            } else {
                var id1 = this.id(attributes.id);
                if (!_instanceof(id1, _mongodb.ObjectId)) throw new Error('Default Mongo id conversion did not produce ObjectId');
                document._id = id1;
                delete document.id;
            }
        }
        return document;
    };
    _proto.nativeToAttributes = function nativeToAttributes(native) {
        var attributes = (0, _valuests.copyValue)(native);
        if (!this.manual && native._id !== undefined) {
            if (!_instanceof(native._id, _mongodb.ObjectId)) throw new Error('Default Mongo document has a non-ObjectId _id');
            attributes.id = native._id.toHexString();
        }
        delete attributes._id;
        return attributes;
    };
    return DocumentCodec;
}();
/* CJS INTEROP */ if (exports.__esModule && exports.default) { try { Object.defineProperty(exports.default, '__esModule', { value: true }); for (var key in exports) { exports.default[key] = exports[key]; } } catch (_) {}; module.exports = exports.default; }