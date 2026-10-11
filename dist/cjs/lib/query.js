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
    get LOGICAL_OPERATORS () {
        return LOGICAL_OPERATORS;
    },
    get compileFilter () {
        return compileFilter;
    },
    get compileSort () {
        return compileSort;
    }
});
var _valuests = require("./values.js");
function _array_like_to_array(arr, len) {
    if (len == null || len > arr.length) len = arr.length;
    for(var i = 0, arr2 = new Array(len); i < len; i++)arr2[i] = arr[i];
    return arr2;
}
function _array_with_holes(arr) {
    if (Array.isArray(arr)) return arr;
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
function _iterable_to_array_limit(arr, i) {
    var _i = arr == null ? null : typeof Symbol !== "undefined" && arr[Symbol.iterator] || arr["@@iterator"];
    if (_i == null) return;
    var _arr = [];
    var _n = true;
    var _d = false;
    var _s, _e;
    try {
        for(_i = _i.call(arr); !(_n = (_s = _i.next()).done); _n = true){
            _arr.push(_s.value);
            if (i && _arr.length === i) break;
        }
    } catch (err) {
        _d = true;
        _e = err;
    } finally{
        try {
            if (!_n && _i["return"] != null) _i["return"]();
        } finally{
            if (_d) throw _e;
        }
    }
    return _arr;
}
function _non_iterable_rest() {
    throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _object_spread(target) {
    for(var i = 1; i < arguments.length; i++){
        var source = arguments[i] != null ? arguments[i] : {};
        var ownKeys = Object.keys(source);
        if (typeof Object.getOwnPropertySymbols === "function") {
            ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function(sym) {
                return Object.getOwnPropertyDescriptor(source, sym).enumerable;
            }));
        }
        ownKeys.forEach(function(key) {
            _define_property(target, key, source[key]);
        });
    }
    return target;
}
function _sliced_to_array(arr, i) {
    return _array_with_holes(arr) || _iterable_to_array_limit(arr, i) || _unsupported_iterable_to_array(arr, i) || _non_iterable_rest();
}
function _unsupported_iterable_to_array(o, minLen) {
    if (!o) return;
    if (typeof o === "string") return _array_like_to_array(o, minLen);
    var n = Object.prototype.toString.call(o).slice(8, -1);
    if (n === "Object" && o.constructor) n = o.constructor.name;
    if (n === "Map" || n === "Set") return Array.from(n);
    if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _array_like_to_array(o, minLen);
}
var LOGICAL_OPERATORS = new Set([
    '$and',
    '$or',
    '$nor'
]);
var VALUE_OPERATORS = new Set([
    '$eq',
    '$ne',
    '$gt',
    '$gte',
    '$lt',
    '$lte'
]);
var MEMBERSHIP_OPERATORS = new Set([
    '$in',
    '$nin'
]);
function setField(target, field, value) {
    Object.defineProperty(target, field, {
        value: value,
        enumerable: true,
        writable: true,
        configurable: true
    });
}
function isQueryDocument(value) {
    return (0, _valuests.isRecord)(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function fieldName(field) {
    if (field.includes('\0') || field.split('.').some(function(part) {
        return !part || part.startsWith('$');
    })) throw new Error("Invalid Mongo query field: ".concat(field));
}
function condition(value, field, codec) {
    var convert = function convert(operand) {
        return field === 'id' ? codec.id(operand) : (0, _valuests.copyValue)(operand);
    };
    if (!isQueryDocument(value) || !Object.keys(value).some(function(key) {
        return key.startsWith('$');
    })) return convert(value);
    var converted = {};
    var _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
    try {
        for(var _iterator = Object.entries(value)[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true){
            var _step_value = _sliced_to_array(_step.value, 2), operator = _step_value[0], operand = _step_value[1];
            if (VALUE_OPERATORS.has(operator)) converted[operator] = convert(operand);
            else if (MEMBERSHIP_OPERATORS.has(operator)) {
                if (!Array.isArray(operand)) throw new Error("Mongo ".concat(field, ".").concat(operator, " requires an array"));
                converted[operator] = operand.map(convert);
            } else if (operator === '$exists') {
                if (typeof operand !== 'boolean') throw new Error("Mongo ".concat(field, ".$exists requires a boolean"));
                converted[operator] = operand;
            } else if (operator === '$not') {
                if (_instanceof(operand, RegExp) && field !== 'id') converted[operator] = (0, _valuests.copyValue)(operand);
                else {
                    if (!isQueryDocument(operand) || !Object.keys(operand).length || Object.keys(operand).some(function(key) {
                        return !key.startsWith('$') || key === '$not';
                    })) throw new Error("Mongo ".concat(field, ".$not requires an operator expression"));
                    converted[operator] = condition(operand, field, codec);
                }
            } else throw new Error("Mongo predicate operator is not implemented: ".concat(field, ".").concat(operator));
        }
    } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
    } finally{
        try {
            if (!_iteratorNormalCompletion && _iterator.return != null) {
                _iterator.return();
            }
        } finally{
            if (_didIteratorError) {
                throw _iteratorError;
            }
        }
    }
    return converted;
}
function logical(operator, value, codec, fieldPolicy) {
    if (!Array.isArray(value) || !value.length) throw new Error("Mongo ".concat(operator, " requires a nonempty array of query documents"));
    return value.map(function(child) {
        return document(child, codec, fieldPolicy);
    });
}
function document(value, codec, fieldPolicy) {
    if (!isQueryDocument(value)) throw new Error('Mongo predicates require query documents');
    var filter = {};
    var _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
    try {
        for(var _iterator = Object.entries(value)[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true){
            var _step_value = _sliced_to_array(_step.value, 2), field = _step_value[0], operand = _step_value[1];
            if (LOGICAL_OPERATORS.has(field)) setField(filter, field, logical(field, operand, codec, fieldPolicy));
            else {
                if (field.startsWith('$')) throw new Error("Mongo query operator is not implemented: ".concat(field));
                fieldName(field);
                fieldPolicy === null || fieldPolicy === void 0 ? void 0 : fieldPolicy(field);
                // Only a model predicate's root id is mapped; embedded literal/path ids are data.
                setField(filter, field === 'id' ? codec.idAttribute : field, condition(operand, field, codec));
            }
        }
    } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
    } finally{
        try {
            if (!_iteratorNormalCompletion && _iterator.return != null) {
                _iterator.return();
            }
        } finally{
            if (_didIteratorError) {
                throw _iteratorError;
            }
        }
    }
    return filter;
}
function compileFilter(find, cursor, codec, fieldPolicy) {
    var effective = _object_spread({}, find);
    var _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
    try {
        for(var _iterator = LOGICAL_OPERATORS[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true){
            var operator = _step.value;
            if (Reflect.getOwnPropertyDescriptor(cursor, operator) === undefined) continue;
            // Cursor sections select the effective operand before validating overwritten find data.
            setField(effective, operator, cursor[operator]);
        }
    } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
    } finally{
        try {
            if (!_iteratorNormalCompletion && _iterator.return != null) {
                _iterator.return();
            }
        } finally{
            if (_didIteratorError) {
                throw _iteratorError;
            }
        }
    }
    var filter = document(effective, codec, fieldPolicy);
    if (cursor.$ids !== undefined) {
        if (!Array.isArray(cursor.$ids)) throw new Error('$ids requires an array');
        // Existing $ids precedence replaces the root id condition, not logical child conditions.
        setField(filter, codec.idAttribute, {
            $in: cursor.$ids.map(function(id) {
                return codec.id(id);
            })
        });
    }
    return filter;
}
function compileSort(value, codec, fieldPolicy) {
    var sort = {};
    var _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
    try {
        for(var _iterator = (0, _valuests.stringList)(value, '$sort')[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true){
            var part = _step.value;
            var trimmed = part.trim();
            var descending = trimmed.startsWith('-');
            var field = (descending ? trimmed.slice(1) : trimmed).trim();
            fieldName(field);
            fieldPolicy === null || fieldPolicy === void 0 ? void 0 : fieldPolicy(field);
            setField(sort, field === 'id' ? codec.idAttribute : field, descending ? -1 : 1);
        }
    } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
    } finally{
        try {
            if (!_iteratorNormalCompletion && _iterator.return != null) {
                _iterator.return();
            }
        } finally{
            if (_didIteratorError) {
                throw _iteratorError;
            }
        }
    }
    return sort;
}
/* CJS INTEROP */ if (exports.__esModule && exports.default) { try { Object.defineProperty(exports.default, '__esModule', { value: true }); for (var key in exports) { exports.default[key] = exports[key]; } } catch (_) {}; module.exports = exports.default; }