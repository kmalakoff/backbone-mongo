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
    get MONGO_SYSTEM_FIELDS () {
        return MONGO_SYSTEM_FIELDS;
    },
    get fetchMongoIncludes () {
        return fetchMongoIncludes;
    },
    get mongoIncludes () {
        return mongoIncludes;
    },
    get rejectMongoRelationPredicate () {
        return rejectMongoRelationPredicate;
    },
    get requireMongoRelation () {
        return requireMongoRelation;
    },
    get validateMongoForeignKeys () {
        return validateMongoForeignKeys;
    },
    get validateMongoRelationGraph () {
        return validateMongoRelationGraph;
    },
    get validateMongoRelations () {
        return validateMongoRelations;
    }
});
var _mongodb = require("mongodb");
var _valuests = require("./values.js");
function _array_like_to_array(arr, len) {
    if (len == null || len > arr.length) len = arr.length;
    for(var i = 0, arr2 = new Array(len); i < len; i++)arr2[i] = arr[i];
    return arr2;
}
function _array_without_holes(arr) {
    if (Array.isArray(arr)) return _array_like_to_array(arr);
}
function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) {
    try {
        var info = gen[key](arg);
        var value = info.value;
    } catch (error) {
        reject(error);
        return;
    }
    if (info.done) resolve(value);
    else Promise.resolve(value).then(_next, _throw);
}
function _async_to_generator(fn) {
    return function() {
        var self = this, args = arguments;
        return new Promise(function(resolve, reject) {
            var gen = fn.apply(self, args);
            function _next(value) {
                asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value);
            }
            function _throw(err) {
                asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err);
            }
            _next(undefined);
        });
    };
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
function _iterable_to_array(iter) {
    if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) {
        return Array.from(iter);
    }
}
function _non_iterable_spread() {
    throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _to_consumable_array(arr) {
    return _array_without_holes(arr) || _iterable_to_array(arr) || _unsupported_iterable_to_array(arr) || _non_iterable_spread();
}
function _ts_generator(thisArg, body) {
    var f, y, t, _ = {
        label: 0,
        sent: function() {
            if (t[0] & 1) throw t[1];
            return t[1];
        },
        trys: [],
        ops: []
    }, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype), d = Object.defineProperty;
    return d(g, "next", {
        value: verb(0)
    }), d(g, "throw", {
        value: verb(1)
    }), d(g, "return", {
        value: verb(2)
    }), typeof Symbol === "function" && d(g, Symbol.iterator, {
        value: function() {
            return this;
        }
    }), g;
    function verb(n) {
        return function(v) {
            return step([
                n,
                v
            ]);
        };
    }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while(g && (g = 0, op[0] && (_ = 0)), _)try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [
                op[0] & 2,
                t.value
            ];
            switch(op[0]){
                case 0:
                case 1:
                    t = op;
                    break;
                case 4:
                    _.label++;
                    return {
                        value: op[1],
                        done: false
                    };
                case 5:
                    _.label++;
                    y = op[1];
                    op = [
                        0
                    ];
                    continue;
                case 7:
                    op = _.ops.pop();
                    _.trys.pop();
                    continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
                        _ = 0;
                        continue;
                    }
                    if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
                        _.label = op[1];
                        break;
                    }
                    if (op[0] === 6 && _.label < t[1]) {
                        _.label = t[1];
                        t = op;
                        break;
                    }
                    if (t && _.label < t[2]) {
                        _.label = t[2];
                        _.ops.push(op);
                        break;
                    }
                    if (t[2]) _.ops.pop();
                    _.trys.pop();
                    continue;
            }
            op = body.call(thisArg, _);
        } catch (e) {
            op = [
                6,
                e
            ];
            y = 0;
        } finally{
            f = t = 0;
        }
        if (op[0] & 5) throw op[1];
        return {
            value: op[0] ? op[1] : void 0,
            done: true
        };
    }
}
function _unsupported_iterable_to_array(o, minLen) {
    if (!o) return;
    if (typeof o === "string") return _array_like_to_array(o, minLen);
    var n = Object.prototype.toString.call(o).slice(8, -1);
    if (n === "Object" && o.constructor) n = o.constructor.name;
    if (n === "Map" || n === "Set") return Array.from(n);
    if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _array_like_to_array(o, minLen);
}
var MONGO_SYSTEM_FIELDS = new Set([
    'id',
    '_id',
    '_rev'
]);
function requireMongoRelation(owner, key, resolve) {
    var relation = owner.schema.relations[key];
    if (!relation || relation.key !== key) throw new Error("Mongo include requires a declared relation key: ".concat(key));
    if (!key || key.includes('.') || key.includes('\0') || key.startsWith('$')) throw new Error('Mongo requires an ordinary relation key');
    if (relation.type !== 'belongsTo' && relation.type !== 'hasMany' && relation.type !== 'hasOne') throw new Error("Mongo ".concat(relation.type, " relations are not implemented: ").concat(key));
    if (relation.isEmbedded() || relation.isVirtual() || relation.join_table) throw new Error("Mongo embedded, virtual or join-table relation is not implemented: ".concat(key));
    if (relation.model_type !== owner.modelType) throw new Error("Mongo relation has an unsupported model owner: ".concat(key));
    var related = resolve(relation.reverse_model_type);
    if (related.modelType !== relation.reverse_model_type || related.connection.url !== owner.connection.url) throw new Error("Mongo relation requires the same registered connection: ".concat(key));
    if (owner.codec.manual || related.codec.manual) throw new Error("Mongo manual-ID relations require a separate ORM compatibility decision: ".concat(key));
    if (relation.type === 'belongsTo' && (!relation.foreign_key || MONGO_SYSTEM_FIELDS.has(relation.foreign_key) || relation.foreign_key.includes('.') || relation.foreign_key.includes('\0') || relation.foreign_key.startsWith('$'))) throw new Error('Mongo requires an ordinary non-system foreign key field');
    var reverse = relation.reverse_relation;
    if (relation.reverse_model_type === owner.modelType && !(relation.type === 'belongsTo' && (reverse === null || reverse === void 0 ? void 0 : reverse.type) === 'hasMany' || relation.type === 'hasMany' && (reverse === null || reverse === void 0 ? void 0 : reverse.type) === 'belongsTo')) throw new Error("Mongo relation has an unsupported model owner: ".concat(key));
    if (relation.type !== 'belongsTo' && (reverse === null || reverse === void 0 ? void 0 : reverse.type) !== 'belongsTo') throw new Error("Mongo ".concat(relation.type, " requires a belongsTo inverse: ").concat(key));
    if (reverse && (reverse.isEmbedded() || reverse.isVirtual() || reverse.join_table || reverse.model_type !== related.modelType || reverse.reverse_model_type !== owner.modelType)) throw new Error("Mongo relation has an unsupported inverse: ".concat(key));
    if (reverse && (relation.type === 'belongsTo' ? reverse.type !== 'hasMany' && reverse.type !== 'hasOne' : reverse.type !== 'belongsTo')) throw new Error("Mongo relation has an unsupported inverse type: ".concat(key));
    if (reverse && related.schema.relations[reverse.key] !== reverse) throw new Error("Mongo relation lost its registered inverse: ".concat(key));
    if (reverse && reverse.reverse_relation !== relation) throw new Error("Mongo relation has an ambiguous inverse: ".concat(key));
    return {
        relation: relation,
        related: related
    };
}
function validateMongoRelations(owner, resolve) {
    var _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
    try {
        for(var _iterator = Object.keys(owner.schema.relations)[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true){
            var key = _step.value;
            requireMongoRelation(owner, key, resolve);
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
}
function validateMongoRelationGraph(owner, resolve) {
    var visited = new Set();
    var visit = function visit1(current) {
        if (visited.has(current.modelType)) return;
        visited.add(current.modelType);
        current.assertAvailable();
        var _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
        try {
            for(var _iterator = Object.keys(current.schema.relations)[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true){
                var key = _step.value;
                var related = requireMongoRelation(current, key, resolve).related;
                visit(related);
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
    };
    visit(owner);
}
function validateMongoForeignKey(relation, related, value) {
    if (value === null || value === undefined) return;
    if (typeof value !== 'string') throw new Error("Mongo foreign key requires a public ObjectId string: ".concat(relation.foreign_key));
    var nativeId = related.codec.id(value);
    if (!_instanceof(nativeId, _mongodb.ObjectId) || nativeId.toHexString() !== value) throw new Error("Mongo foreign key requires canonical public ObjectId text: ".concat(relation.foreign_key));
}
function validateMongoForeignKeys(owner, attributes, resolve) {
    var _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
    try {
        for(var _iterator = Object.keys(owner.schema.relations)[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true){
            var key = _step.value;
            var _requireMongoRelation = requireMongoRelation(owner, key, resolve), relation = _requireMongoRelation.relation, related = _requireMongoRelation.related;
            if (relation.type === 'belongsTo') validateMongoForeignKey(relation, related, attributes[relation.foreign_key]);
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
}
function mongoIncludes(owner, value, resolve) {
    owner.assertAvailable();
    if (value === undefined) return [];
    return _to_consumable_array(new Set((0, _valuests.stringList)(value, '$include'))).map(function(key) {
        var included = requireMongoRelation(owner, key, resolve);
        included.related.assertAvailable();
        return included;
    });
}
function relatedJSON(owner, query) {
    return new Promise(function(accept, reject) {
        var callback = function callback(error, value) {
            return error ? reject(error) : accept(value);
        };
        owner.cursor(query).toJSON(callback);
    });
}
function fetchMongoIncludes(rows, includes) {
    return _async_to_generator(function() {
        var _iteratorNormalCompletion, _didIteratorError, _iteratorError, _iterator, _step, _step_value, relation, related, _iteratorNormalCompletion1, _didIteratorError1, _iteratorError1, _iterator1, _step1, row, value, foreignId, _tmp, reverse, _obj, err, err;
        return _ts_generator(this, function(_state) {
            switch(_state.label){
                case 0:
                    _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
                    _state.label = 1;
                case 1:
                    _state.trys.push([
                        1,
                        17,
                        18,
                        19
                    ]);
                    _iterator = includes[Symbol.iterator]();
                    _state.label = 2;
                case 2:
                    if (!!(_iteratorNormalCompletion = (_step = _iterator.next()).done)) return [
                        3,
                        16
                    ];
                    _step_value = _step.value, relation = _step_value.relation, related = _step_value.related;
                    _iteratorNormalCompletion1 = true, _didIteratorError1 = false, _iteratorError1 = undefined;
                    _state.label = 3;
                case 3:
                    _state.trys.push([
                        3,
                        13,
                        14,
                        15
                    ]);
                    _iterator1 = rows[Symbol.iterator]();
                    _state.label = 4;
                case 4:
                    if (!!(_iteratorNormalCompletion1 = (_step1 = _iterator1.next()).done)) return [
                        3,
                        12
                    ];
                    row = _step1.value;
                    related.assertAvailable();
                    value = void 0;
                    if (!(relation.type === 'belongsTo')) return [
                        3,
                        8
                    ];
                    foreignId = row[relation.foreign_key];
                    validateMongoForeignKey(relation, related, foreignId);
                    if (!(foreignId === null || foreignId === undefined)) return [
                        3,
                        5
                    ];
                    _tmp = null;
                    return [
                        3,
                        7
                    ];
                case 5:
                    return [
                        4,
                        relatedJSON(related, {
                            id: foreignId,
                            $one: true
                        })
                    ];
                case 6:
                    _tmp = _state.sent();
                    _state.label = 7;
                case 7:
                    value = _tmp;
                    if (value !== null && !(0, _valuests.isRecord)(value)) throw new Error('Mongo belongsTo include returned an unexpected row shape');
                    return [
                        3,
                        10
                    ];
                case 8:
                    reverse = relation.reverse_relation;
                    if (!reverse) throw new Error("Mongo ".concat(relation.type, " include lost its inverse"));
                    if (row.id === null || row.id === undefined) throw new Error("Mongo ".concat(relation.type, " include requires the private parent identity"));
                    return [
                        4,
                        relatedJSON(related, relation.type === 'hasOne' ? (_obj = {}, _define_property(_obj, reverse.foreign_key, row.id), _define_property(_obj, "$one", true), _obj) : _define_property({}, reverse.foreign_key, row.id))
                    ];
                case 9:
                    value = _state.sent();
                    if (relation.type === 'hasOne') {
                        if (value !== null && !(0, _valuests.isRecord)(value)) throw new Error('Mongo hasOne include returned an unexpected row shape');
                    } else if (!Array.isArray(value) || value.some(function(entry) {
                        return !(0, _valuests.isRecord)(entry);
                    })) throw new Error('Mongo hasMany include returned an unexpected row shape');
                    _state.label = 10;
                case 10:
                    Object.defineProperty(row, relation.key, {
                        value: value,
                        enumerable: true,
                        configurable: true,
                        writable: true
                    });
                    _state.label = 11;
                case 11:
                    _iteratorNormalCompletion1 = true;
                    return [
                        3,
                        4
                    ];
                case 12:
                    return [
                        3,
                        15
                    ];
                case 13:
                    err = _state.sent();
                    _didIteratorError1 = true;
                    _iteratorError1 = err;
                    return [
                        3,
                        15
                    ];
                case 14:
                    try {
                        if (!_iteratorNormalCompletion1 && _iterator1.return != null) {
                            _iterator1.return();
                        }
                    } finally{
                        if (_didIteratorError1) {
                            throw _iteratorError1;
                        }
                    }
                    return [
                        7
                    ];
                case 15:
                    _iteratorNormalCompletion = true;
                    return [
                        3,
                        2
                    ];
                case 16:
                    return [
                        3,
                        19
                    ];
                case 17:
                    err = _state.sent();
                    _didIteratorError = true;
                    _iteratorError = err;
                    return [
                        3,
                        19
                    ];
                case 18:
                    try {
                        if (!_iteratorNormalCompletion && _iterator.return != null) {
                            _iterator.return();
                        }
                    } finally{
                        if (_didIteratorError) {
                            throw _iteratorError;
                        }
                    }
                    return [
                        7
                    ];
                case 19:
                    return [
                        2
                    ];
            }
        });
    })();
}
function rejectMongoRelationPredicate(schema, field) {
    var root = field.split('.')[0];
    if (Reflect.getOwnPropertyDescriptor(schema.relations, root) !== undefined) throw new Error("Mongo relation predicates are not implemented: ".concat(field));
}
/* CJS INTEROP */ if (exports.__esModule && exports.default) { try { Object.defineProperty(exports.default, '__esModule', { value: true }); for (var key in exports) { exports.default[key] = exports[key]; } } catch (_) {}; module.exports = exports.default; }