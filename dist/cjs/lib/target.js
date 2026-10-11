"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "resolveMongoTarget", {
    enumerable: true,
    get: function() {
        return resolveMongoTarget;
    }
});
var _nodecrypto = require("node:crypto");
var _mongodbconnectionstringurl = /*#__PURE__*/ _interop_require_default(require("mongodb-connection-string-url"));
var _valuests = require("./values.js");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function resolveMongoTarget(modelURL, options) {
    try {
        var _parts_at;
        // This is the Mongo driver's parser, including SRV, host lists and escaped credentials.
        var parsed = new _mongodbconnectionstringurl.default(modelURL);
        var parts = parsed.pathname.split('/');
        if (parts[0] !== '' || parts.length < 2 || parts.length > 3 || !parts.at(-1)) throw new Error('Missing collection');
        var collection = decodeURIComponent((_parts_at = parts.at(-1)) !== null && _parts_at !== void 0 ? _parts_at : '');
        var database = parts.length === 3 ? decodeURIComponent(parts[1]) : undefined;
        if (database === '') throw new Error('Missing database');
        parsed.pathname = parts.length === 3 ? "/".concat(parts[1]) : '/';
        parsed.searchParams.sort();
        var uri = parsed.toString();
        var key = "backbone-mongo:".concat((0, _nodecrypto.createHash)('sha256').update(uri).digest('hex'));
        return {
            collection: collection,
            database: database,
            key: key,
            uri: uri,
            options: (0, _valuests.copyValue)(options)
        };
    } catch (unused) {
        throw new Error('Invalid Mongo model URL; expected a Mongo connection URI ending in a collection name');
    }
}
/* CJS INTEROP */ if (exports.__esModule && exports.default) { try { Object.defineProperty(exports.default, '__esModule', { value: true }); for (var key in exports) { exports.default[key] = exports[key]; } } catch (_) {}; module.exports = exports.default; }