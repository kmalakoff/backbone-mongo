"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return MongoDatabaseTools;
    }
});
var _backboneorm = /*#__PURE__*/ _interop_require_default(require("backbone-orm"));
var _settlets = require("./settle.js");
function _array_like_to_array(arr, len) {
    if (len == null || len > arr.length) len = arr.length;
    for(var i = 0, arr2 = new Array(len); i < len; i++)arr2[i] = arr[i];
    return arr2;
}
function _array_with_holes(arr) {
    if (Array.isArray(arr)) return arr;
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
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
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
function _sliced_to_array(arr, i) {
    return _array_with_holes(arr) || _iterable_to_array_limit(arr, i) || _unsupported_iterable_to_array(arr, i) || _non_iterable_rest();
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
function optionsAndCallback(options, callback) {
    var notify = typeof options === 'function' ? options : callback;
    if (typeof notify !== 'function') throw new Error('Mongo database operation requires a callback');
    return [
        typeof options === 'function' ? {} : options,
        notify
    ];
}
var MongoDatabaseTools = /*#__PURE__*/ function() {
    "use strict";
    function MongoDatabaseTools(connection, schema, idAttribute, validateGraph) {
        _class_call_check(this, MongoDatabaseTools);
        this.connection = connection;
        this.schema = schema;
        this.idAttribute = idAttribute;
        this.validateGraph = validateGraph;
        this.dropTable = this.dropTable.bind(this);
        this.ensureIndex = this.ensureIndex.bind(this);
        this.createOrUpdateTable = this.createOrUpdateTable.bind(this);
        this.ensureSchema = this.ensureSchema.bind(this);
        this.resetSchema = this.resetSchema.bind(this);
    }
    var _proto = MongoDatabaseTools.prototype;
    _proto.ensureSchema = function ensureSchema(optionsOrCallback, callback) {
        var _optionsAndCallback = _sliced_to_array(optionsAndCallback(optionsOrCallback, callback), 2), options = _optionsAndCallback[0], notify = _optionsAndCallback[1];
        this.schemaOperation(false, options, notify);
    };
    _proto.resetSchema = function resetSchema(optionsOrCallback, callback) {
        var _optionsAndCallback = _sliced_to_array(optionsAndCallback(optionsOrCallback, callback), 2), options = _optionsAndCallback[0], notify = _optionsAndCallback[1];
        this.schemaOperation(true, options, notify);
    };
    _proto.schemaOperation = function schemaOperation(reset, options, callback) {
        var _this = this;
        (0, _settlets.operationCallback)(function() {
            if (!options || (typeof options === "undefined" ? "undefined" : _type_of(options)) !== 'object' || Array.isArray(options)) throw new Error('Mongo schema options must be an object');
            if (options.verbose !== undefined && typeof options.verbose !== 'boolean') throw new Error('Mongo schema verbose must be a boolean');
            return _this.connection.scheduleSchemaOperation(function() {
                return _async_to_generator(function() {
                    var _this;
                    return _ts_generator(this, function(_state) {
                        switch(_state.label){
                            case 0:
                                _this = this;
                                if (!reset) return [
                                    3,
                                    2
                                ];
                                return [
                                    4,
                                    new Promise(function(resolve, reject) {
                                        return _this.dropTable(options, function(error) {
                                            return error ? reject(error) : resolve();
                                        });
                                    })
                                ];
                            case 1:
                                _state.sent();
                                _state.label = 2;
                            case 2:
                                return [
                                    4,
                                    new Promise(function(resolve, reject) {
                                        return _this.createOrUpdateTable(options, function(error) {
                                            return error ? reject(error) : resolve();
                                        });
                                    })
                                ];
                            case 3:
                                _state.sent();
                                return [
                                    2
                                ];
                        }
                    });
                }).call(_this);
            }, _this.validateGraph);
        }, function(error) {
            return callback(error !== null && error !== void 0 ? error : null);
        });
    };
    _proto.dropTable = function dropTable(optionsOrCallback, callback) {
        var _this = this;
        var _optionsAndCallback = _sliced_to_array(optionsAndCallback(optionsOrCallback, callback), 2), options = _optionsAndCallback[0], notify = _optionsAndCallback[1];
        (0, _settlets.operationCallback)(function() {
            _this.validateGraph();
            return _this.connection.use(function(collection) {
                return _async_to_generator(function() {
                    var error, safe;
                    return _ts_generator(this, function(_state) {
                        switch(_state.label){
                            case 0:
                                this.validateGraph();
                                _state.label = 1;
                            case 1:
                                _state.trys.push([
                                    1,
                                    3,
                                    ,
                                    4
                                ]);
                                return [
                                    4,
                                    collection.deleteMany({})
                                ];
                            case 2:
                                _state.sent();
                                return [
                                    3,
                                    4
                                ];
                            case 3:
                                error = _state.sent();
                                safe = (0, _settlets.driverError)(error, 'dropTable');
                                if (options.verbose) console.log("Failed to reset collection: ".concat(collection.collectionName, ". Error: ").concat(safe.message));
                                throw safe;
                            case 4:
                                if (options.verbose) console.log("Reset collection: ".concat(collection.collectionName));
                                return [
                                    2
                                ];
                        }
                    });
                }).call(_this);
            });
        }, function(error) {
            return notify(error !== null && error !== void 0 ? error : null);
        });
    };
    _proto.ensureIndex = function ensureIndex(field, optionsOrCallback, callback) {
        var _this = this;
        var _optionsAndCallback = _sliced_to_array(optionsAndCallback(optionsOrCallback, callback), 2), options = _optionsAndCallback[0], notify = _optionsAndCallback[1];
        (0, _settlets.operationCallback)(function() {
            _this.validateGraph();
            return _this.connection.use(function(collection) {
                return _async_to_generator(function() {
                    var error;
                    return _ts_generator(this, function(_state) {
                        switch(_state.label){
                            case 0:
                                this.validateGraph();
                                _state.label = 1;
                            case 1:
                                _state.trys.push([
                                    1,
                                    3,
                                    ,
                                    4
                                ]);
                                return [
                                    4,
                                    collection.createIndex(_define_property({}, field, 1), field === '_id' ? {} : {
                                        background: true
                                    })
                                ];
                            case 2:
                                _state.sent();
                                return [
                                    3,
                                    4
                                ];
                            case 3:
                                error = _state.sent();
                                throw (0, _settlets.driverError)(error, 'ensureIndex');
                            case 4:
                                if (options.verbose) console.log("MongoBackbone: Successfully indexed '".concat(field, "' on ").concat(collection.collectionName));
                                return [
                                    2
                                ];
                        }
                    });
                }).call(_this);
            });
        }, function(error) {
            return error ? notify(error) : notify();
        });
    };
    _proto.createOrUpdateTable = function createOrUpdateTable(options, callback) {
        var _this = this;
        if (typeof callback !== 'function') throw new Error('Mongo createOrUpdateTable requires a callback');
        (0, _settlets.operationCallback)(function() {
            return _async_to_generator(function() {
                var _this;
                return _ts_generator(this, function(_state) {
                    switch(_state.label){
                        case 0:
                            _this = this;
                            this.validateGraph();
                            return [
                                4,
                                this.connection.use(function(collection) {
                                    return _async_to_generator(function() {
                                        return _ts_generator(this, function(_state) {
                                            this.validateGraph();
                                            if (options.verbose) console.log("Ensuring table: ".concat(collection.collectionName, " with fields: '").concat(Object.keys(this.schema.fields).join(', '), "' and relations: '").concat(Object.keys(this.schema.relations).join(', '), "'"));
                                            return [
                                                2
                                            ];
                                        });
                                    }).call(_this);
                                })
                            ];
                        case 1:
                            _state.sent();
                            this.validateGraph();
                            return [
                                2,
                                new Promise(function(resolve, reject) {
                                    var queue = new _backboneorm.default.Queue();
                                    queue.defer(function(next) {
                                        return _this.ensureIndex(_this.idAttribute, options, next);
                                    });
                                    var _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
                                    try {
                                        var _loop = function() {
                                            var _step_value = _sliced_to_array(_step.value, 2), key = _step_value[0], field = _step_value[1];
                                            if (field.indexed) queue.defer(function(next) {
                                                return _this.ensureIndex(key, options, next);
                                            });
                                        };
                                        for(var _iterator = Object.entries(_this.schema.fields)[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true)_loop();
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
                                    var _iteratorNormalCompletion1 = true, _didIteratorError1 = false, _iteratorError1 = undefined;
                                    try {
                                        var _loop1 = function() {
                                            var relation = _step1.value;
                                            if (relation.type === 'belongsTo' && !relation.isVirtual() && !relation.isEmbedded()) queue.defer(function(next) {
                                                return _this.ensureIndex(relation.foreign_key, options, next);
                                            });
                                        };
                                        for(var _iterator1 = Object.values(_this.schema.relations)[Symbol.iterator](), _step1; !(_iteratorNormalCompletion1 = (_step1 = _iterator1.next()).done); _iteratorNormalCompletion1 = true)_loop1();
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
                                    queue.await(function(error) {
                                        return error ? reject(error) : resolve();
                                    });
                                })
                            ];
                    }
                });
            }).call(_this);
        }, function(error) {
            return callback(error !== null && error !== void 0 ? error : null);
        });
    };
    return MongoDatabaseTools;
}();
/* CJS INTEROP */ if (exports.__esModule && exports.default) { try { Object.defineProperty(exports.default, '__esModule', { value: true }); for (var key in exports) { exports.default[key] = exports[key]; } } catch (_) {}; module.exports = exports.default; }