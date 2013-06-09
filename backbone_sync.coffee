util = require 'util'
_ = require 'underscore'
moment = require 'moment'
Queue = require 'queue-async'

MongoCursor = require './lib/mongo_cursor'
Connection = require './lib/connection'

CLASS_METHODS = [
  'initialize'
  'cursor', 'find'
  'count', 'all', 'destroy'
  'findOneNearDate'
]

module.exports = class MongoBackboneSync

  constructor: (@model_type) ->
    @backbone_adapter = @model_type.backbone_adapter = @_selectAdapter()

    throw new Error 'Missing url for model' unless url = _.result((new @model_type()), 'url')
    @schema = _.result(@model_type, 'schema') or {}
    @connection = new Connection(url, @schema)

    # publish methods and sync on model
    @model_type[fn] = _.bind(@[fn], @) for fn in CLASS_METHODS
    @model_type._sync = @

  initialize: (model) ->
    # TODO: add relations

  ###################################
  # Classic Backbone Sync
  ###################################
  read: (model, options) ->
    # a collection
    if model.models
      @cursor().toJSON (err, json) ->
        return options.error(err) if err
        options.success?(json)

    # a model
    else
      @cursor(@backbone_adapter.modelFindQuery(model)).limit(1).toJSON (err, json) ->
        return options.error(err) if err
        return options.error(new Error "Model not found. Id #{model.get('id')}") if json.length isnt 1
        options.success?(json)

  create: (model, options) ->
    return options.error(new Error("Missing manual id for create: #{util.inspect(model.attributes)}")) if @manual_id and not model.get('id')

    @connection.collection (err, collection) =>
      return options.error(err) if err
      return options.error(new Error('new document has a non-empty revision')) if model.get('_rev')
      doc = @backbone_adapter.attributesToNative(model.toJSON()); doc._rev = 1 # start revisions
      collection.insert doc, (err, docs) =>
        return options.error(new Error("Failed to create model")) if err or not docs or docs.length isnt 1
        options.success?(@backbone_adapter.nativeToAttributes(docs[0]))

  update: (model, options) ->
    return @create(model, options) unless model.get('_rev') # no revision, create - in the case we manually set an id and are saving for the first time
    return options.error(new Error("Missing manual id for create: #{util.inspect(model.attributes)}")) if @manual_id and not model.get('id')

    @connection.collection (err, collection) =>
      return options.error(err) if err
      json = @backbone_adapter.attributesToNative(model.toJSON())
      delete json._id if @backbone_adapter.idAttribute is '_id'
      find_query = @backbone_adapter.modelFindQuery(model)
      find_query._rev = json._rev
      json._rev++ # increment revisions

      # update the record
      collection.findAndModify find_query, [[@backbone_adapter.idAttribute,'asc']], {$set: json}, {new: true}, (err, doc) =>
        return options.error(new Error("Failed to update model. #{err}")) if err or not doc
        return options.error(new Error("Failed to update revision. Is: #{doc._rev} expecting: #{json._rev}")) if doc._rev isnt json._rev

        # look for removed attributes that need to be deleted
        expected_keys = _.keys(json); expected_keys.push('_id'); saved_keys = _.keys(doc)
        keys_to_delete = _.difference(saved_keys, expected_keys)
        return options.success?(@backbone_adapter.nativeToAttributes(doc)) unless keys_to_delete.length

        # delete/unset attributes and update the revision
        find_query._rev = json._rev
        json._rev++ # increment revisions
        keys = {}
        keys[key] = '' for key in keys_to_delete
        collection.findAndModify find_query, [[@backbone_adapter.idAttribute,'asc']], {$unset: keys, $set: {_rev: json._rev}}, {new: true}, (err, doc) =>
          return options.error(new Error("Failed to update model. #{err}")) if err or not doc
          return options.error(new Error("Failed to update revision. Is: #{doc._rev} expecting: #{json._rev}")) if doc._rev isnt json._rev
          options.success?(@backbone_adapter.nativeToAttributes(doc))

  delete: (model, options) ->
    @destroy @backbone_adapter.modelFindQuery(model), (err) ->
      return options.error(model, err, options) if err
      options.success?(model, {}, options)

  ###################################
  # Collection Extensions
  ###################################
  cursor: (query={}) -> return new MongoCursor(query, _.pick(@, ['model_type', 'connection', 'backbone_adapter']))

  find: (query, callback) ->
    [query, callback] = [{}, query] if arguments.length is 1
    @cursor(query).toModels(callback)

  ###################################
  # Convenience Functions
  ###################################
  all: (callback) -> @cursor({}).toModels callback

  count: (query, callback) ->
    [query, callback] = [{}, query] if arguments.length is 1
    @cursor(query).count(callback)

  destroy: (query, callback) ->
    @initialize() unless @connection

    [query, callback] = [{}, query] if arguments.length is 1
    @connection.collection (err, collection) =>
      return callback(err) if err
      collection.remove @backbone_adapter.attributesToNative(query), callback

  # options:
  #  @key: default 'created_at'
  #  @reverse: default false
  #  @date: default now
  #  @query: default none
  findOneNearDate: (options, callback) ->
    key = options.key or 'created_at'
    date = options.date or moment.utc().toDate()
    query = _.clone(options.query or {})

    findForward = (callback) =>
      query[key] = {$lte: date.toISOString()}
      @model_type.findCursor query, (err, cursor) =>
        return callback(err) if err

        cursor.limit(1).sort([[key, 'desc']]).toArray (err, docs) =>
          return callback(err) if err
          return callback(null, null) unless docs.length

          callback(null, @model_type.docsToModels(docs)[0])

    findReverse = (callback) =>
      query[key] = {$gte: date.toISOString()}
      @model_type.findCursor query, (err, cursor) =>
        return callback(err) if err

        cursor.limit(1).sort([[key, 'asc']]).toArray (err, docs) =>
          return callback(err) if err
          return callback(null, null) unless docs.length

          callback(null, @model_type.docsToModels(docs)[0])

    if options.reverse
      findReverse (err, model) =>
        return callback(err) if err
        return callback(null, model) if model
        findForward callback
    else
      findForward (err, model) =>
        return callback(err) if err
        return callback(null, model) if model
        findReverse callback

  ###################################
  # Internal
  ###################################
  _selectAdapter: ->
    schema = _.result(@model_type, 'schema') or {}
    for field_name, field_info of schema
      continue if (field_name isnt 'id') or not _.isArray(field_info)
      for info in field_info
        if info.manual_id
          @manual_id = true
          return require './lib/document_adapter_no_mongo_id'
    return require './lib/document_adapter_mongo_id' # default is using the mongodb's ids

# options
#   model_type - the model that will be used to add query functions to
module.exports = (model_type) ->
  sync = new MongoBackboneSync(model_type)
  return (method, model, options={}) -> sync[method](model, options)
