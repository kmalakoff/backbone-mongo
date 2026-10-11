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
    get configureConnections () {
        return configureConnections;
    },
    get default () {
        return _default;
    }
});
var _nodeutil = require("node:util");
var _backbone = /*#__PURE__*/ _interop_require_default(require("backbone"));
var _backboneorm = /*#__PURE__*/ _interop_require_default(require("backbone-orm"));
var _mongodb = require("mongodb");
var _cursorts = /*#__PURE__*/ _interop_require_default(require("./cursor.js"));
var _connectionts = /*#__PURE__*/ _interop_require_default(require("./lib/connection.js"));
var _databasetoolsts = /*#__PURE__*/ _interop_require_default(require("./lib/database-tools.js"));
var _documentts = /*#__PURE__*/ _interop_require_default(require("./lib/document.js"));
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
function ownKeys(object, enumerableOnly) {
    var keys = Object.keys(object);
    if (Object.getOwnPropertySymbols) {
        var symbols = Object.getOwnPropertySymbols(object);
        if (enumerableOnly) {
            symbols = symbols.filter(function(sym) {
                return Object.getOwnPropertyDescriptor(object, sym).enumerable;
            });
        }
        keys.push.apply(keys, symbols);
    }
    return keys;
}
function _object_spread_props(target, source) {
    source = source != null ? source : {};
    if (Object.getOwnPropertyDescriptors) Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
    else {
        ownKeys(Object(source)).forEach(function(key) {
            Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
        });
    }
    return target;
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
var _models_MODEL_CONFIGURATION_KEY;
function isSyncOptions(value) {
    return (0, _valuests.isRecord)(value) && typeof value.success === 'function' && typeof value.error === 'function';
}
function requireOptions(value) {
    if (!isSyncOptions(value)) throw new Error('Mongo sync requires success and error callbacks');
    return value;
}
function hasSchemaControl(value) {
    return typeof Reflect.get(value, 'schema') === 'function';
}
function manualID(schema) {
    var field = schema.fields.id;
    return (field === null || field === void 0 ? void 0 : field.manual) === true || (field === null || field === void 0 ? void 0 : field.manual_id) === true;
}
var MongoSync = /*#__PURE__*/ function() {
    "use strict";
    function MongoSync(modelType, options) {
        var _this = this;
        _class_call_check(this, MongoSync);
        var _modelType, _model_name;
        this.pendingUnsets = new WeakMap();
        this.modelType = modelType;
        var model = new modelType();
        if (model.idAttribute !== 'id') throw new Error('Mongo first slice requires the public id attribute');
        var url;
        try {
            url = model.url();
        } catch (unused) {
            throw new Error('Missing Mongo URL for model');
        }
        if (typeof url !== 'string') throw new Error('Missing Mongo URL for model');
        this.connection = new _connectionts.default(url, options);
        this.table = this.connection.collectionName;
        (_model_name = (_modelType = modelType).model_name) !== null && _model_name !== void 0 ? _model_name : _modelType.model_name = _backboneorm.default.naming_conventions.modelName(this.table, false);
        this.schema = new _backboneorm.default.Schema(modelType, {
            id: {
                type: _mongodb.ObjectId
            }
        });
        this.codec = new _documentts.default(manualID(this.schema));
        var tools = new _databasetoolsts.default(this.connection, this.schema, this.codec.idAttribute, function() {
            return _this.validateGraph();
        });
        this.databaseControl = {
            connection: this.connection,
            dropTable: tools.dropTable,
            ensureIndex: tools.ensureIndex,
            createOrUpdateTable: tools.createOrUpdateTable,
            ensureSchema: tools.ensureSchema,
            resetSchema: tools.resetSchema
        };
    }
    var _proto = MongoSync.prototype;
    _proto.initializeSchema = function initializeSchema() {
        var _this = this;
        this.schema.initialize();
        (0, _relationsts.validateMongoRelations)(this.relationOwner(true), function(type) {
            return _this.resolveRelatedOwner(type, true);
        });
    };
    _proto.validateGraph = function validateGraph() {
        var _this = this;
        (0, _relationsts.validateMongoRelationGraph)(this.relationOwner(), function(type) {
            return _this.resolveRelatedOwner(type);
        });
    };
    _proto.requireRegistration = function requireRegistration() {
        var allowInitializing = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : false;
        var _registration_failure;
        var registration = models.get(this.modelType);
        if (!registration || registration.implementation !== this) throw new Error('Mongo model registration was replaced');
        if (registration.state === 'failed') throw (_registration_failure = registration.failure) !== null && _registration_failure !== void 0 ? _registration_failure : new Error('Mongo model configuration failed');
        if (registration.state === 'initializing' && !allowInitializing) throw new Error('Mongo model configuration is incomplete');
        if (this.modelType.prototype.sync !== registration.sync) throw new Error('Mongo model sync owner was replaced');
        var schemaProvider = Reflect.get(this.modelType, 'schema');
        if (typeof schemaProvider !== 'function' || Reflect.apply(schemaProvider, this.modelType, []) !== this.schema) throw new Error('Mongo model schema owner was replaced');
        return registration;
    };
    _proto.relationOwner = function relationOwner() {
        var _this = this;
        var allowInitializing = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : false;
        this.requireRegistration(allowInitializing);
        return {
            modelType: this.modelType,
            schema: this.schema,
            connection: this.connection,
            codec: this.codec,
            assertAvailable: function assertAvailable() {
                _this.requireRegistration();
                _this.connection.assertAvailable();
            },
            cursor: function cursor(query) {
                return _this.cursor(query);
            }
        };
    };
    _proto.resolveRelatedOwner = function resolveRelatedOwner(type) {
        var allowInitializing = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : false;
        var registration = models.get(type);
        if (!registration) throw new Error('Mongo relation requires a registered Mongo model');
        if (!(0, _nodeutil.isDeepStrictEqual)(registration.options, this.requireRegistration(allowInitializing).options)) throw new Error('Mongo relation connection options conflict');
        return registration.implementation.relationOwner(allowInitializing);
    };
    _proto.relationContext = function relationContext() {
        var _this = this;
        return {
            owner: this.relationOwner(),
            resolve: function resolve(type) {
                return _this.resolveRelatedOwner(type);
            }
        };
    };
    _proto.cursor = function cursor() {
        var _this = this;
        var query = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
        return new _cursorts.default(query, this.modelType, this.connection, this.codec, function() {
            return _this.relationContext();
        });
    };
    _proto.db = function db() {
        return this.databaseControl;
    };
    _proto.collection = function collection(callback) {
        this.connection.collection(callback);
    };
    _proto.dispatch = function dispatch(method, target, optionsValue) {
        var _this = this;
        if (method === 'sync') return this;
        if (method === 'schema') return this.schema;
        if (method === 'tableName') return this.table;
        if (method === 'isRemote') return false;
        if (method === 'db') return this.db();
        if (method === 'initialize') {
            var _registration_failure;
            var registration = models.get(this.modelType);
            if ((registration === null || registration === void 0 ? void 0 : registration.state) === 'failed') throw (_registration_failure = registration.failure) !== null && _registration_failure !== void 0 ? _registration_failure : new Error('Mongo model configuration failed');
            return;
        }
        if (method === 'cursor') return this.cursor(target);
        if (method === 'destroy') {
            var callback = typeof target === 'function' ? target : optionsValue;
            if (typeof callback !== 'function') throw new Error('destroy requires a callback');
            return (0, _settlets.operationCallback)(function() {
                return _this.destroy(typeof target === 'function' ? {} : target);
            }, function(error, count) {
                if (error) callback(error);
                else callback(null, count);
            });
        }
        if (method === 'resetSchema') {
            var callback1 = typeof target === 'function' ? target : optionsValue;
            if (typeof callback1 !== 'function') throw new Error("".concat(method, " requires a callback"));
            return typeof target === 'function' ? this.databaseControl.resetSchema(target) : this.databaseControl.resetSchema(target, callback1);
        }
        if (method === 'collection') {
            if (typeof target !== 'function') throw new Error('Mongo collection requires a callback');
            return (0, _settlets.operationCallback)(function() {
                _this.validateGraph();
                return _this.connection.use(function(collection) {
                    return _async_to_generator(function() {
                        return _ts_generator(this, function(_state) {
                            this.validateGraph();
                            return [
                                2,
                                collection
                            ];
                        });
                    }).call(_this);
                });
            }, function(error, collection) {
                return target(error, collection);
            });
        }
        if (method === 'closeConnection') {
            if (target === undefined) return this.connection.destroy();
            if (typeof target !== 'function') throw new Error('Mongo closeConnection requires a callback');
            return this.connection.destroy(function(error) {
                return target(error);
            });
        }
        if (![
            'create',
            'read',
            'update',
            'patch',
            'delete'
        ].includes(method)) return undefined;
        var options = requireOptions(optionsValue);
        (0, _settlets.operationCallback)(function() {
            return _async_to_generator(function() {
                return _ts_generator(this, function(_state) {
                    if (method === 'read') return [
                        2,
                        this.read(target, options.query)
                    ];
                    if (!_instanceof(target, _backbone.default.Model)) throw new Error('Mongo write requires the canonical Backbone model');
                    this.validateGraph();
                    if (method === 'create') return [
                        2,
                        this.create(target)
                    ];
                    if (method === 'update' || method === 'patch') return [
                        2,
                        this.update(target)
                    ];
                    return [
                        2,
                        this.delete(target)
                    ];
                });
            }).call(_this);
        }, function(error, value) {
            if (error) options.error(error);
            else options.success(value);
        });
        return;
    };
    _proto.read = function read(target, query) {
        return _async_to_generator(function() {
            var json;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        if (_instanceof(target, _backbone.default.Collection)) return [
                            2,
                            this.cursorResult(this.cursor(query))
                        ];
                        if (!_instanceof(target, _backbone.default.Model)) throw new Error('Mongo read requires the canonical Backbone model or collection');
                        return [
                            4,
                            this.cursorResult(this.cursor({
                                id: target.id,
                                $one: true
                            }))
                        ];
                    case 1:
                        json = _state.sent();
                        if (json === null) throw new Error('Model not found');
                        return [
                            2,
                            json
                        ];
                }
            });
        }).call(this);
    };
    _proto.cursorResult = function cursorResult(cursor) {
        return new Promise(function(resolve, reject) {
            var callback = function callback(error, value) {
                if (error) reject(error);
                else resolve(value);
            };
            cursor.toJSON(callback);
        });
    };
    _proto.create = function create(model) {
        return _async_to_generator(function() {
            var _this, json, document;
            return _ts_generator(this, function(_state) {
                _this = this;
                if (this.codec.manual && (model.id === undefined || model.id === null)) throw new Error('Set a manual Mongo id before saving');
                if (model.get('_rev')) throw new Error('New document has a non-empty revision');
                json = model.toJSON();
                if (!(0, _valuests.isRecord)(json)) throw new Error('Mongo model JSON must be an object');
                document = this.codec.attributesToNative(json);
                (0, _relationsts.validateMongoForeignKeys)(this.relationOwner(), document, function(type) {
                    return _this.resolveRelatedOwner(type);
                });
                document._rev = 1;
                return [
                    2,
                    this.connection.use(function(collection) {
                        return _async_to_generator(function() {
                            var _this, result, error;
                            return _ts_generator(this, function(_state) {
                                switch(_state.label){
                                    case 0:
                                        _this = this;
                                        this.validateGraph();
                                        (0, _relationsts.validateMongoForeignKeys)(this.relationOwner(), document, function(type) {
                                            return _this.resolveRelatedOwner(type);
                                        });
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
                                            collection.insertOne(document)
                                        ];
                                    case 2:
                                        result = _state.sent();
                                        if (!result.acknowledged) throw new Error('Insert was not acknowledged');
                                        document._id = result.insertedId;
                                        return [
                                            3,
                                            4
                                        ];
                                    case 3:
                                        error = _state.sent();
                                        throw (0, _settlets.driverError)(error, 'create');
                                    case 4:
                                        return [
                                            2,
                                            this.codec.nativeToAttributes(document)
                                        ];
                                }
                            });
                        }).call(_this);
                    })
                ];
            });
        }).call(this);
    };
    _proto.update = function update(model) {
        return _async_to_generator(function() {
            var _this, _this_pendingUnsets_get, revision, json, document, filter, pending, publicUnsets, _iteratorNormalCompletion, _didIteratorError, _iteratorError, _iterator, _step, key, unsets, modifications;
            return _ts_generator(this, function(_state) {
                _this = this;
                revision = model.get('_rev');
                if (revision === undefined || revision === null || revision === 0) return [
                    2,
                    this.create(model)
                ];
                if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1 || revision === Number.MAX_SAFE_INTEGER) throw new Error('Mongo _rev must be a positive safe integer');
                json = model.toJSON();
                if (!(0, _valuests.isRecord)(json)) throw new Error('Mongo model JSON must be an object');
                document = this.codec.attributesToNative(json);
                (0, _relationsts.validateMongoForeignKeys)(this.relationOwner(), document, function(type) {
                    return _this.resolveRelatedOwner(type);
                });
                delete document._id;
                document._rev = revision + 1;
                filter = _object_spread_props(_object_spread({}, this.codec.findId(model.id)), {
                    _rev: revision
                });
                pending = (_this_pendingUnsets_get = this.pendingUnsets.get(model)) !== null && _this_pendingUnsets_get !== void 0 ? _this_pendingUnsets_get : new Set();
                publicUnsets = _backboneorm.default.Utils.get(model, 'unsets');
                _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
                if (publicUnsets !== undefined && publicUnsets !== null) try {
                    for(_iterator = (0, _valuests.stringList)(publicUnsets, 'Mongo unsets')[Symbol.iterator](); !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true){
                        key = _step.value;
                        pending.add(key);
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
                this.pendingUnsets.set(model, pending);
                unsets = _to_consumable_array(pending).filter(function(key) {
                    var relation = _this.schema.relation(key);
                    var serializedForeignKey = (relation === null || relation === void 0 ? void 0 : relation.type) === 'belongsTo' && relation.foreign_key === key && Reflect.getOwnPropertyDescriptor(document, key) !== undefined;
                    return !serializedForeignKey && Reflect.getOwnPropertyDescriptor(model.attributes, key) === undefined;
                });
                if (unsets.some(function(key) {
                    return _relationsts.MONGO_SYSTEM_FIELDS.has(key);
                })) throw new Error('Cannot unset Mongo identity or revision');
                modifications = {
                    $set: document
                };
                if (unsets.length) modifications.$unset = Object.fromEntries(unsets.map(function(key) {
                    return [
                        key,
                        ''
                    ];
                }));
                return [
                    2,
                    this.connection.use(function(collection) {
                        return _async_to_generator(function() {
                            var _this, result, error;
                            return _ts_generator(this, function(_state) {
                                switch(_state.label){
                                    case 0:
                                        _this = this;
                                        this.validateGraph();
                                        (0, _relationsts.validateMongoForeignKeys)(this.relationOwner(), document, function(type) {
                                            return _this.resolveRelatedOwner(type);
                                        });
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
                                            collection.findOneAndUpdate(filter, modifications, {
                                                returnDocument: 'after',
                                                includeResultMetadata: false,
                                                upsert: false
                                            })
                                        ];
                                    case 2:
                                        result = _state.sent();
                                        return [
                                            3,
                                            4
                                        ];
                                    case 3:
                                        error = _state.sent();
                                        throw (0, _settlets.driverError)(error, 'update');
                                    case 4:
                                        if (!result) throw new Error('Failed to update model. Either the document has been deleted or the revision (_rev) was stale.');
                                        if (result._rev !== document._rev) throw new Error('Mongo update returned an unexpected revision');
                                        this.pendingUnsets.delete(model);
                                        return [
                                            2,
                                            this.codec.nativeToAttributes(result)
                                        ];
                                }
                            });
                        }).call(_this);
                    })
                ];
            });
        }).call(this);
    };
    _proto.destroy = function destroy(query) {
        return _async_to_generator(function() {
            var _this, each;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        _this = this;
                        this.validateGraph();
                        return [
                            4,
                            this.connection.use(function() {
                                return _async_to_generator(function() {
                                    return _ts_generator(this, function(_state) {
                                        this.validateGraph();
                                        return [
                                            2
                                        ];
                                    });
                                }).call(_this);
                            })
                        ];
                    case 1:
                        _state.sent();
                        each = Reflect.get(this.modelType, 'each');
                        if (typeof each !== 'function') throw new Error('Mongo destroy requires the configured ORM each');
                        return [
                            2,
                            new Promise(function(resolve, reject) {
                                Reflect.apply(each, _this.modelType, [
                                    _object_spread({
                                        $each: {
                                            limit: 1000,
                                            json: true
                                        }
                                    }, query),
                                    function(model, next) {
                                        return (0, _settlets.operationCallback)(function() {
                                            return _this.delete(model);
                                        }, function(error) {
                                            return next(error);
                                        });
                                    },
                                    function(error, count) {
                                        if (error) reject(error);
                                        else resolve(count);
                                    }
                                ]);
                            })
                        ];
                }
            });
        }).call(this);
    };
    _proto.delete = function _delete(model) {
        return _async_to_generator(function() {
            var _this, filter;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        _this = this;
                        filter = this.codec.findId(model.id);
                        return [
                            4,
                            this.connection.use(function(collection) {
                                return _async_to_generator(function() {
                                    var error, modelType;
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
                                                    collection.deleteMany(filter)
                                                ];
                                            case 2:
                                                _state.sent();
                                                return [
                                                    3,
                                                    4
                                                ];
                                            case 3:
                                                error = _state.sent();
                                                throw (0, _settlets.driverError)(error, 'delete');
                                            case 4:
                                                modelType = this.modelType;
                                                if (!hasSchemaControl(modelType)) throw new Error('Mongo deletion requires the configured ORM schema');
                                                // Native deletion precedes ORM cleanup and cannot be rolled back if cleanup fails.
                                                return [
                                                    4,
                                                    new Promise(function(resolve, reject) {
                                                        _backboneorm.default.Utils.patchRemove(modelType, model, function(error) {
                                                            if (error) reject(error);
                                                            else resolve();
                                                        });
                                                    })
                                                ];
                                            case 5:
                                                _state.sent();
                                                if (_instanceof(model, _backbone.default.Model)) this.pendingUnsets.delete(model);
                                                return [
                                                    2
                                                ];
                                        }
                                    });
                                }).call(_this);
                            })
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
    return MongoSync;
}();
var MODEL_REGISTRY_KEY = Symbol.for('backbone-mongo.model-registry.v1');
var MODEL_CONFIGURATION_KEY = Symbol.for('backbone-mongo.model-registry.configuration.v1');
function registry() {
    var existing = Reflect.get(globalThis, MODEL_REGISTRY_KEY);
    if (existing !== undefined) {
        if (!_instanceof(existing, WeakMap)) throw new Error('Invalid shared Mongo model registry');
        return existing;
    }
    var created = new WeakMap();
    Object.defineProperty(globalThis, MODEL_REGISTRY_KEY, {
        value: created
    });
    return created;
}
var models = registry();
var configuration = (_models_MODEL_CONFIGURATION_KEY = models[MODEL_CONFIGURATION_KEY]) !== null && _models_MODEL_CONFIGURATION_KEY !== void 0 ? _models_MODEL_CONFIGURATION_KEY : {
    depth: 0
};
if (models[MODEL_CONFIGURATION_KEY] === undefined) Object.defineProperty(models, MODEL_CONFIGURATION_KEY, {
    value: configuration
});
var defaultOptions = {};
function validateConnectionOptions(options) {
    var forceServerObjectId = Reflect.get(options, 'forceServerObjectId');
    if (forceServerObjectId === true) throw new Error('forceServerObjectId=true is unsupported; Mongo requires client-assigned native IDs');
}
function configureConnections(options) {
    var resolved = _object_spread({}, defaultOptions, (0, _valuests.copyValue)(options));
    validateConnectionOptions(resolved);
    defaultOptions = resolved;
}
function isModelConstructor(value) {
    return typeof value === 'function' && (value === _backbone.default.Model || _instanceof(Reflect.get(value, 'prototype'), _backbone.default.Model));
}
function isCollectionConstructor(value) {
    return typeof value === 'function' && _instanceof(Reflect.get(value, 'prototype'), _backbone.default.Collection);
}
function sync(type) {
    var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
    var _configuration_batch;
    var resolved = _object_spread({}, defaultOptions, (0, _valuests.copyValue)(options));
    validateConnectionOptions(resolved);
    if (isCollectionConstructor(type)) {
        var previousModel = type.prototype.model;
        if (isModelConstructor(previousModel) && previousModel.prototype.sync !== _backbone.default.Model.prototype.sync && !models.has(previousModel)) throw new Error('Mongo collection model is already configured with a different sync owner');
        var modelType = _backboneorm.default.Utils.configureCollectionModelType(type, function(model) {
            return sync(model, resolved);
        });
        return sync(modelType, resolved);
    }
    if (!isModelConstructor(type)) throw new Error('Mongo sync requires the canonical Backbone model constructor');
    var existing = models.get(type);
    if (existing) {
        var _existing_failure;
        if (existing.state === 'failed') throw (_existing_failure = existing.failure) !== null && _existing_failure !== void 0 ? _existing_failure : new Error('Mongo model configuration failed');
        if (existing.state === 'initializing' && configuration.depth === 0) throw new Error('Mongo model configuration is incomplete');
        if (!(0, _nodeutil.isDeepStrictEqual)(existing.options, resolved)) throw new Error('Mongo model is already configured with a different sync or options');
        var currentSync = type.prototype.sync;
        if (currentSync !== existing.sync) throw new Error('Mongo model is already configured with a different sync or options');
        return currentSync;
    }
    if (type.prototype.sync !== _backbone.default.Model.prototype.sync) throw new Error('Mongo model is already configured with a different sync owner');
    var implementation = new MongoSync(type, resolved);
    function adapter(method, target, optionsValue) {
        if (method === 'createSync') {
            if (!isModelConstructor(target)) throw new Error('createSync requires a Backbone model constructor');
            return sync(target, resolved);
        }
        return implementation.dispatch(method, target, optionsValue);
    }
    var contract = adapter;
    var registration = {
        implementation: implementation,
        options: resolved,
        sync: contract,
        state: 'initializing'
    };
    if (configuration.depth === 0) configuration.batch = [];
    (_configuration_batch = configuration.batch) === null || _configuration_batch === void 0 ? void 0 : _configuration_batch.push(registration);
    models.set(type, registration);
    configuration.depth += 1;
    try {
        Reflect.set(type.prototype, 'sync', contract);
        _backboneorm.default.Utils.configureModelType(type);
        implementation.initializeSchema();
        var configured = _backboneorm.default.model_cache.configureSync(type, type.prototype.sync);
        registration.sync = configured;
        Reflect.set(type.prototype, 'sync', configured);
        registration.state = 'ready';
        if (configuration.depth === 1) implementation.validateGraph();
        return configured;
    } catch (error) {
        var _configuration_batch1;
        registration.failure = _instanceof(error, Error) ? error : new Error('Mongo schema configuration threw a non-Error value');
        registration.state = 'failed';
        var _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
        if (configuration.depth === 1) try {
            for(var _iterator = ((_configuration_batch1 = configuration.batch) !== null && _configuration_batch1 !== void 0 ? _configuration_batch1 : [])[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true){
                var member = _step.value;
                member.failure = registration.failure;
                member.state = 'failed';
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
        throw registration.failure;
    } finally{
        configuration.depth -= 1;
        if (configuration.depth === 0) configuration.batch = undefined;
    }
}
var CAPABILITIES = {
    dynamic: true,
    json: true,
    manual_ids: true,
    embed: false,
    self_reference: false,
    unique: false
};
var syncFactory = Object.assign(sync, {
    capabilities: function capabilities() {
        return _object_spread({}, CAPABILITIES);
    }
});
var _default = syncFactory;
/* CJS INTEROP */ if (exports.__esModule && exports.default) { try { Object.defineProperty(exports.default, '__esModule', { value: true }); for (var key in exports) { exports.default[key] = exports[key]; } } catch (_) {}; module.exports = exports.default; }