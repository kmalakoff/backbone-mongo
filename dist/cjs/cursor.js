"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return MongoCursor;
    }
});
var _backboneorm = /*#__PURE__*/ _interop_require_default(require("backbone-orm"));
var _queryts = require("./lib/query.js");
var _relationsts = require("./lib/relations.js");
var _settlets = require("./lib/settle.js");
var _valuests = require("./lib/values.js");
function _array_like_to_array(arr, len) {
    if (len == null || len > arr.length) len = arr.length;
    for(var i = 0, arr2 = new Array(len); i < len; i++)arr2[i] = arr[i];
    return arr2;
}
function _array_without_holes(arr) {
    if (Array.isArray(arr)) return _array_like_to_array(arr);
}
function _assert_this_initialized(self) {
    if (self === void 0) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    return self;
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
function _call_super(_this, derived, args) {
    derived = _get_prototype_of(derived);
    return _possible_constructor_return(_this, _is_native_reflect_construct() ? Reflect.construct(derived, args || [], _get_prototype_of(_this).constructor) : derived.apply(_this, args));
}
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
function _get_prototype_of(o) {
    _get_prototype_of = Object.setPrototypeOf ? Object.getPrototypeOf : function getPrototypeOf(o) {
        return o.__proto__ || Object.getPrototypeOf(o);
    };
    return _get_prototype_of(o);
}
function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
        throw new TypeError("Super expression must either be null or a function");
    }
    subClass.prototype = Object.create(superClass && superClass.prototype, {
        constructor: {
            value: subClass,
            writable: true,
            configurable: true
        }
    });
    if (superClass) _set_prototype_of(subClass, superClass);
}
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function _is_native_reflect_construct() {
    try {
        var result = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {}));
    } catch (_) {}
    return (_is_native_reflect_construct = function() {
        return !!result;
    })();
}
function _iterable_to_array(iter) {
    if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) {
        return Array.from(iter);
    }
}
function _non_iterable_spread() {
    throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
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
function _possible_constructor_return(self, call) {
    if (call && (_type_of(call) === "object" || typeof call === "function")) return call;
    return _assert_this_initialized(self);
}
function _set_prototype_of(o, p) {
    _set_prototype_of = Object.setPrototypeOf || function setPrototypeOf(o, p) {
        o.__proto__ = p;
        return o;
    };
    return _set_prototype_of(o, p);
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
function _type_of(obj) {
    "@swc/helpers - typeof";
    return obj && typeof Symbol !== "undefined" && obj.constructor === Symbol ? "symbol" : typeof obj;
}
function _unsupported_iterable_to_array(o, minLen) {
    if (!o) return;
    if (typeof o === "string") return _array_like_to_array(o, minLen);
    var n = Object.prototype.toString.call(o).slice(8, -1);
    if (n === "Object" && o.constructor) n = o.constructor.name;
    if (n === "Map" || n === "Set") return Array.from(n);
    if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _array_like_to_array(o, minLen);
}
var CURSOR_KEYS = new Set([
    '$count',
    '$exists',
    '$ids',
    '$include',
    '$limit',
    '$offset',
    '$one',
    '$page',
    '$select',
    '$sort',
    '$values',
    '$whitelist',
    '$zero'
]);
var MongoCursor = /*#__PURE__*/ function(_BackboneORM_Cursor) {
    "use strict";
    _inherits(MongoCursor, _BackboneORM_Cursor);
    function MongoCursor(query, modelType, connection, codec, relationContext) {
        _class_call_check(this, MongoCursor);
        var _this;
        // ORM's scalar parser treats 0 as no query; make the adapter's manual-id lookup explicit.
        _this = _call_super(this, MongoCursor, [
            query === 0 ? {
                id: 0,
                $one: true
            } : (0, _valuests.copyValue)(query),
            {
                model_type: modelType
            }
        ]);
        _this.connection = connection;
        _this.codec = codec;
        _this.relationContext = relationContext;
        return _this;
    }
    var _proto = MongoCursor.prototype;
    _proto.queryToJSON = function queryToJSON(callback) {
        var _this = this;
        (0, _settlets.operationCallback)(function() {
            return _this.query();
        }, function(error, value) {
            return callback(error, value);
        });
    };
    _proto.query = function query() {
        return _async_to_generator(function() {
            var _this, _ref, _this__cursor_$values, _iteratorNormalCompletion, _didIteratorError, _iteratorError, _iterator, _step, key, context, includes, fieldPolicy, filter, findOptions, requested, whitelist, fields, _iteratorNormalCompletion1, _didIteratorError1, _iteratorError1, _iterator1, _step1, field, nativeFields, privateForeignKeys;
            return _ts_generator(this, function(_state) {
                _this = this;
                _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
                try {
                    for(_iterator = Object.keys(this._cursor)[Symbol.iterator](); !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true){
                        key = _step.value;
                        if (!CURSOR_KEYS.has(key) && !_queryts.LOGICAL_OPERATORS.has(key)) throw new Error("Mongo cursor control is not implemented: ".concat(key));
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
                context = this.relationContext();
                includes = (0, _relationsts.mongoIncludes)(context.owner, this._cursor.$include, context.resolve);
                if (this.hasCursorQuery('$zero')) return [
                    2,
                    this.hasCursorQuery('$one') ? null : []
                ];
                fieldPolicy = function fieldPolicy(field) {
                    return (0, _relationsts.rejectMongoRelationPredicate)(context.owner.schema, field);
                };
                filter = (0, _queryts.compileFilter)(this._find, this._cursor, this.codec, fieldPolicy);
                findOptions = {};
                if (this._cursor.$offset !== undefined) findOptions.skip = (0, _valuests.nonnegativeInteger)(this._cursor.$offset, '$offset');
                if (this._cursor.$limit !== undefined) findOptions.limit = (0, _valuests.nonnegativeInteger)(this._cursor.$limit, '$limit');
                if (this.hasCursorQuery('$one')) findOptions.limit = 1;
                if (this._cursor.$sort !== undefined) findOptions.sort = (0, _queryts.compileSort)(this._cursor.$sort, this.codec, fieldPolicy);
                requested = (_ref = (_this__cursor_$values = this._cursor.$values) !== null && _this__cursor_$values !== void 0 ? _this__cursor_$values : this._cursor.$select) !== null && _ref !== void 0 ? _ref : this._cursor.$whitelist;
                if (requested !== undefined) {
                    whitelist = this._cursor.$whitelist === undefined ? undefined : (0, _valuests.stringList)(this._cursor.$whitelist, '$whitelist');
                    fields = (0, _valuests.stringList)(requested, 'Mongo projection').filter(function(field) {
                        return !whitelist || whitelist.includes(field);
                    });
                    _iteratorNormalCompletion1 = true, _didIteratorError1 = false, _iteratorError1 = undefined;
                    try {
                        for(_iterator1 = fields[Symbol.iterator](); !(_iteratorNormalCompletion1 = (_step1 = _iterator1.next()).done); _iteratorNormalCompletion1 = true){
                            field = _step1.value;
                            if (field.includes('.')) fieldPolicy(field);
                        }
                    } catch (err) {
                        _didIteratorError1 = true;
                        _iteratorError1 = err;
                    } finally{
                        try {
                            if (!_iteratorNormalCompletion1 && _iterator1.return != null) {
                                _iterator1.return();
                            }
                        } finally{
                            if (_didIteratorError1) {
                                throw _iteratorError1;
                            }
                        }
                    }
                    nativeFields = fields.filter(function(field) {
                        return !includes.some(function(param) {
                            var relation = param.relation;
                            return relation.key === field;
                        });
                    });
                    privateForeignKeys = includes.filter(function(param) {
                        var relation = param.relation;
                        return relation.type === 'belongsTo';
                    }).map(function(param) {
                        var relation = param.relation;
                        return relation.foreign_key;
                    });
                    // Keep the native identity long enough to decode it, then let ORM select public fields.
                    findOptions.projection = _object_spread({
                        _id: 1
                    }, Object.fromEntries(_to_consumable_array(nativeFields).concat(_to_consumable_array(privateForeignKeys)).map(function(field) {
                        return [
                            field === 'id' ? _this.codec.idAttribute : field,
                            1
                        ];
                    })));
                }
                return [
                    2,
                    this.connection.use(function(collection) {
                        return _async_to_generator(function() {
                            var _this, _findOptions_skip, currentContext, currentIncludes, rows, totalRows, cursor, error;
                            return _ts_generator(this, function(_state) {
                                switch(_state.label){
                                    case 0:
                                        _this = this;
                                        currentContext = this.relationContext();
                                        currentIncludes = (0, _relationsts.mongoIncludes)(currentContext.owner, this._cursor.$include, currentContext.resolve);
                                        rows = [];
                                        totalRows = 0;
                                        _state.label = 1;
                                    case 1:
                                        _state.trys.push([
                                            1,
                                            13,
                                            ,
                                            14
                                        ]);
                                        if (!this.hasCursorQuery('$count')) return [
                                            3,
                                            3
                                        ];
                                        return [
                                            4,
                                            collection.countDocuments(filter)
                                        ];
                                    case 2:
                                        return [
                                            2,
                                            _state.sent()
                                        ];
                                    case 3:
                                        if (!this.hasCursorQuery('$exists')) return [
                                            3,
                                            5
                                        ];
                                        return [
                                            4,
                                            collection.findOne(filter, {
                                                projection: {
                                                    _id: 1
                                                }
                                            })
                                        ];
                                    case 4:
                                        return [
                                            2,
                                            _state.sent() !== null
                                        ];
                                    case 5:
                                        if (!(findOptions.limit !== 0)) return [
                                            3,
                                            10
                                        ];
                                        cursor = collection.find(filter, findOptions);
                                        _state.label = 6;
                                    case 6:
                                        _state.trys.push([
                                            6,
                                            ,
                                            8,
                                            10
                                        ]);
                                        return [
                                            4,
                                            cursor.toArray()
                                        ];
                                    case 7:
                                        rows = _state.sent().map(function(document) {
                                            return _this.codec.nativeToAttributes(document);
                                        });
                                        return [
                                            3,
                                            10
                                        ];
                                    case 8:
                                        return [
                                            4,
                                            cursor.close()
                                        ];
                                    case 9:
                                        _state.sent();
                                        return [
                                            7
                                        ];
                                    case 10:
                                        if (!this.hasCursorQuery('$page')) return [
                                            3,
                                            12
                                        ];
                                        return [
                                            4,
                                            collection.countDocuments(filter)
                                        ];
                                    case 11:
                                        totalRows = _state.sent();
                                        _state.label = 12;
                                    case 12:
                                        return [
                                            3,
                                            14
                                        ];
                                    case 13:
                                        error = _state.sent();
                                        throw (0, _settlets.driverError)(error, 'query');
                                    case 14:
                                        return [
                                            4,
                                            (0, _relationsts.fetchMongoIncludes)(rows, currentIncludes)
                                        ];
                                    case 15:
                                        _state.sent();
                                        if (this.hasCursorQuery('$page')) return [
                                            2,
                                            {
                                                offset: (_findOptions_skip = findOptions.skip) !== null && _findOptions_skip !== void 0 ? _findOptions_skip : 0,
                                                total_rows: totalRows,
                                                rows: this.selectResults(rows)
                                            }
                                        ];
                                        return [
                                            2,
                                            this.selectResults(rows)
                                        ];
                                }
                            });
                        }).call(_this);
                    })
                ];
            });
        }).call(this);
    };
    return MongoCursor;
}(_backboneorm.default.Cursor);
/* CJS INTEROP */ if (exports.__esModule && exports.default) { try { Object.defineProperty(exports.default, '__esModule', { value: true }); for (var key in exports) { exports.default[key] = exports[key]; } } catch (_) {}; module.exports = exports.default; }