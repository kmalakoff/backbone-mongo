"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return MongoConnection;
    }
});
var _nodeutil = require("node:util");
var _backboneorm = /*#__PURE__*/ _interop_require_default(require("backbone-orm"));
var _mongodb = require("mongodb");
var _queuecb = /*#__PURE__*/ _interop_require_default(require("queue-cb"));
var _settlets = require("./settle.js");
var _targetts = require("./target.js");
var _valuests = require("./values.js");
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
function _instanceof(left, right) {
    "@swc/helpers - instanceof";
    if (right != null && typeof Symbol !== "undefined" && right[Symbol.hasInstance]) {
        return !!right[Symbol.hasInstance](left);
    } else return left instanceof right;
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
var OWNERSHIP_KEY = Symbol.for('backbone-mongo.client-ownership.v1');
function drainOperations(state) {
    return new Promise(function(resolve) {
        var queue = new _queuecb.default(1);
        var _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
        try {
            var _loop = function() {
                var operation = _step.value;
                // Each operation delivers its error to its caller; disposal only awaits settlement.
                queue.defer(function(done) {
                    void operation.then(function() {
                        return done();
                    }, function() {
                        return done();
                    });
                });
            };
            for(var _iterator = state.operations[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true)_loop();
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
        queue.await(function() {
            return resolve();
        });
    });
}
function closeClient(state) {
    if (state.closePromise) return state.closePromise;
    state.closing = true;
    state.closePromise = function() {
        return _async_to_generator(function() {
            var error;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        return [
                            4,
                            drainOperations(state)
                        ];
                    case 1:
                        _state.sent();
                        _state.label = 2;
                    case 2:
                        _state.trys.push([
                            2,
                            4,
                            ,
                            5
                        ]);
                        return [
                            4,
                            state.client.close()
                        ];
                    case 3:
                        _state.sent();
                        return [
                            3,
                            5
                        ];
                    case 4:
                        error = _state.sent();
                        throw (0, _settlets.driverError)(error, 'client close');
                    case 5:
                        return [
                            2
                        ];
                }
            });
        })();
    }();
    return state.closePromise;
}
function disposeOriginalClient(state) {
    if (state.pool.get(state.key) === state.client) return state.pool.dispose(state.key);
    return closeClient(state);
}
function isOwnership(value) {
    return (typeof value === "undefined" ? "undefined" : _type_of(value)) === 'object' && value !== null && _instanceof(Reflect.get(value, 'states'), WeakMap) && typeof Reflect.get(value, 'disposer') === 'function';
}
function sharedOwnership() {
    var existing = Reflect.get(globalThis, OWNERSHIP_KEY);
    if (existing !== undefined) {
        if (!isOwnership(existing)) throw new Error('Invalid shared Mongo client ownership state');
        return existing;
    }
    var states = new WeakMap();
    var ownership = {
        states: states,
        disposer: function disposer(client, callback) {
            var state = states.get(client);
            if (!(state === null || state === void 0 ? void 0 : state.owned)) {
                callback(new Error('Mongo disposer received an unowned client'));
                return;
            }
            (0, _settlets.operationCallback)(function() {
                return closeClient(state);
            }, function(error) {
                return callback(error);
            });
        }
    };
    Object.defineProperty(globalThis, OWNERSHIP_KEY, {
        value: ownership
    });
    return ownership;
}
var ownership = sharedOwnership();
function clientConfiguration(client) {
    // Driver 7.7 adds per-instance Promises and a logger writer closure, not configuration.
    var configuration = Object.fromEntries(Object.entries(client.options).filter(function(param) {
        var _param = _sliced_to_array(param, 1), key = _param[0];
        return ![
            'metadata',
            'runtime',
            'mongoLoggerOptions'
        ].includes(key);
    }));
    var logger = Reflect.get(client.options, 'mongoLoggerOptions');
    if ((0, _valuests.isRecord)(logger)) configuration.mongoLoggerOptions = Object.fromEntries(Object.entries(logger).filter(function(param) {
        var _param = _sliced_to_array(param, 1), key = _param[0];
        return key !== 'logDestination';
    }));
    return configuration;
}
function acquireClient(target, connection) {
    var pool = _backboneorm.default.ConnectionPool;
    var pooled = pool.get(target.key);
    if (pooled !== undefined && !_instanceof(pooled, _mongodb.MongoClient)) throw new Error('ConnectionPool entry is not a MongoClient');
    var state = pooled ? ownership.states.get(pooled) : undefined;
    if (state) {
        if (state.closing) throw new Error('Mongo client is closed');
        if (state.key !== target.key || !(0, _nodeutil.isDeepStrictEqual)(state.options, target.options)) throw new Error('Mongo client options conflict with an existing pooled client');
    } else {
        var candidate;
        try {
            candidate = new _mongodb.MongoClient(target.uri, target.options);
        } catch (unused) {
            throw new Error('Invalid Mongo client options or connection URI');
        }
        if (candidate.options.forceServerObjectId) throw new Error('forceServerObjectId=true is unsupported; Mongo requires client-assigned native IDs');
        // A foreign client's actual driver-resolved options must agree before it is borrowed.
        if (pooled && !(0, _nodeutil.isDeepStrictEqual)(clientConfiguration(pooled), clientConfiguration(candidate))) throw new Error('Borrowed Mongo client options do not match the requested connection');
        state = {
            client: pooled !== null && pooled !== void 0 ? pooled : candidate,
            key: target.key,
            options: target.options,
            owned: pooled === undefined,
            pool: pool,
            leases: new Set(),
            operations: new Set(),
            closing: false,
            connectionFailed: false
        };
        ownership.states.set(state.client, state);
        if (state.owned) pool.setOwned(target.key, state.client, ownership.disposer);
    }
    state.leases.add(connection);
    return state;
}
var MongoConnection = /*#__PURE__*/ function() {
    "use strict";
    function MongoConnection(modelURL, options) {
        _class_call_check(this, MongoConnection);
        this.released = false;
        this.target = (0, _targetts.resolveMongoTarget)(modelURL, options);
        this.url = this.target.key;
        this.collectionName = this.target.collection;
    }
    var _proto = MongoConnection.prototype;
    _proto.assertAvailable = function assertAvailable() {
        var _this_state;
        if (this.released) throw new Error('Mongo connection is closed');
        var pooled = _backboneorm.default.ConnectionPool.get(this.target.key);
        if (pooled !== undefined && !_instanceof(pooled, _mongodb.MongoClient)) throw new Error('ConnectionPool entry is not a MongoClient');
        var state = (_this_state = this.state) !== null && _this_state !== void 0 ? _this_state : _instanceof(pooled, _mongodb.MongoClient) ? ownership.states.get(pooled) : undefined;
        if (state === null || state === void 0 ? void 0 : state.closing) throw new Error('Mongo client is closed');
        if (this.state && this.state.pool.get(this.state.key) !== this.state.client) throw new Error('Mongo pooled client was replaced');
    };
    _proto.clientState = function clientState() {
        var _this_state;
        this.assertAvailable();
        var state = (_this_state = this.state) !== null && _this_state !== void 0 ? _this_state : acquireClient(this.target, this);
        this.state = state;
        if (state.closing) throw new Error('Mongo client is closed');
        if (state.pool.get(state.key) !== state.client) throw new Error('Mongo pooled client was replaced');
        return state;
    };
    _proto.scheduleSchemaOperation = function scheduleSchemaOperation(operation, verify) {
        var _this = this;
        return new Promise(function(resolve, reject) {
            var _state, _schemaQueue;
            verify();
            var state = _this.clientState();
            (_schemaQueue = (_state = state).schemaQueue) !== null && _schemaQueue !== void 0 ? _schemaQueue : _state.schemaQueue = new _backboneorm.default.Queue(1);
            state.schemaQueue.defer(function(done) {
                var complete = function complete(failed, error) {
                    // Only native requests are tracked; an outer job must not enter the disposal drain.
                    void drainOperations(state).then(function() {
                        done(null);
                        if (failed) reject(error);
                        else resolve();
                    }, function(cleanup) {
                        done(null);
                        reject(failed ? new AggregateError([
                            error,
                            cleanup
                        ], 'Mongo schema operation/native drain failed') : cleanup);
                    });
                };
                void Promise.resolve().then(function() {
                    _this.assertAvailable();
                    verify();
                    return operation();
                }).then(function() {
                    return complete(false);
                }, function(error) {
                    return complete(true, error);
                });
            });
        });
    };
    _proto.use = function use(operation) {
        return _async_to_generator(function() {
            var _this, state, pending, error, cleanup;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        _this = this;
                        state = this.clientState();
                        pending = Promise.resolve().then(function() {
                            return _async_to_generator(function() {
                                var _state, _ready, collection;
                                return _ts_generator(this, function(_state1) {
                                    switch(_state1.label){
                                        case 0:
                                            if (state.closing) throw new Error('Mongo client is closed');
                                            (_ready = (_state = state).ready) !== null && _ready !== void 0 ? _ready : _state.ready = state.client.connect().then(function() {
                                                return undefined;
                                            }, function(error) {
                                                state.connectionFailed = true;
                                                throw (0, _settlets.driverError)(error, 'connection');
                                            });
                                            return [
                                                4,
                                                state.ready
                                            ];
                                        case 1:
                                            _state1.sent();
                                            if (this.released || state.closing) throw new Error('Mongo connection is closed');
                                            if (state.pool.get(state.key) !== state.client) throw new Error('Mongo pooled client was replaced');
                                            collection = state.client.db(this.target.database).collection(this.target.collection);
                                            return [
                                                2,
                                                operation(collection)
                                            ];
                                    }
                                });
                            }).call(_this);
                        });
                        state.operations.add(pending);
                        _state.label = 1;
                    case 1:
                        _state.trys.push([
                            1,
                            3,
                            8,
                            9
                        ]);
                        return [
                            4,
                            pending
                        ];
                    case 2:
                        return [
                            2,
                            _state.sent()
                        ];
                    case 3:
                        error = _state.sent();
                        if (!(state.connectionFailed && state.owned)) return [
                            3,
                            7
                        ];
                        _state.label = 4;
                    case 4:
                        _state.trys.push([
                            4,
                            6,
                            ,
                            7
                        ]);
                        return [
                            4,
                            disposeOriginalClient(state)
                        ];
                    case 5:
                        _state.sent();
                        return [
                            3,
                            7
                        ];
                    case 6:
                        cleanup = _state.sent();
                        throw new AggregateError([
                            error,
                            cleanup
                        ], 'Mongo connection failed and original client cleanup failed');
                    case 7:
                        throw error;
                    case 8:
                        state.operations.delete(pending);
                        return [
                            7
                        ];
                    case 9:
                        return [
                            2
                        ];
                }
            });
        }).call(this);
    };
    _proto.collection = function collection(callback) {
        var _this = this;
        (0, _settlets.operationCallback)(function() {
            return _this.use(function(collection) {
                return _async_to_generator(function() {
                    return _ts_generator(this, function(_state) {
                        return [
                            2,
                            collection
                        ];
                    });
                })();
            });
        }, callback);
    };
    _proto.destroy = function destroy(callback) {
        var _this = this;
        var _this_releasePromise;
        this.released = true;
        (_this_releasePromise = this.releasePromise) !== null && _this_releasePromise !== void 0 ? _this_releasePromise : this.releasePromise = this.release();
        if (!callback) return this.releasePromise;
        (0, _settlets.operationCallback)(function() {
            return _this.releasePromise;
        }, function(error) {
            return callback(error);
        });
    };
    _proto.release = function release() {
        return _async_to_generator(function() {
            var state;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        state = this.state;
                        if (!state) return [
                            2
                        ];
                        state.leases.delete(this);
                        if (!state.owned || state.leases.size !== 0) return [
                            2
                        ];
                        return [
                            4,
                            disposeOriginalClient(state)
                        ];
                    case 1:
                        _state.sent();
                        return [
                            2
                        ];
                }
            });
        }).call(this);
    };
    return MongoConnection;
}();
/* CJS INTEROP */ if (exports.__esModule && exports.default) { try { Object.defineProperty(exports.default, '__esModule', { value: true }); for (var key in exports) { exports.default[key] = exports[key]; } } catch (_) {}; module.exports = exports.default; }