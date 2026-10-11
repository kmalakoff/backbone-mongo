"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get driverError () {
        return driverError;
    },
    get operationCallback () {
        return operationCallback;
    }
});
function _instanceof(left, right) {
    "@swc/helpers - instanceof";
    if (right != null && typeof Symbol !== "undefined" && right[Symbol.hasInstance]) {
        return !!right[Symbol.hasInstance](left);
    } else return left instanceof right;
}
function _type_of(obj) {
    "@swc/helpers - typeof";
    return obj && typeof Symbol !== "undefined" && obj.constructor === Symbol ? "symbol" : typeof obj;
}
function operationCallback(operation, callback) {
    // Notification is outside the Promise chain so a customer throw is not a driver rejection.
    void Promise.resolve().then(operation).then(function(value) {
        return queueMicrotask(function() {
            return callback(null, value);
        });
    }, function(error) {
        return queueMicrotask(function() {
            return callback(_instanceof(error, Error) ? error : new Error('Mongo operation threw a non-Error value'));
        });
    });
}
function driverError(error, phase) {
    // Driver parse/transport messages can contain connection credentials.
    var safe = new Error("Mongo ".concat(phase, " failed"));
    if ((typeof error === "undefined" ? "undefined" : _type_of(error)) === 'object' && error !== null) {
        var code = Reflect.get(error, 'code');
        if (typeof code === 'number') Object.defineProperty(safe, 'code', {
            value: code,
            enumerable: true
        });
    }
    return safe;
}
/* CJS INTEROP */ if (exports.__esModule && exports.default) { try { Object.defineProperty(exports.default, '__esModule', { value: true }); for (var key in exports) { exports.default[key] = exports[key]; } } catch (_) {}; module.exports = exports.default; }