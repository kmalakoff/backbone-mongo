###
  backbone-mongo.js 0.5.0
  Copyright (c) 2013 Vidigami - https://github.com/vidigami/backbone-mongo
  License: MIT (http://www.opensource.org/licenses/mit-license.php)
###

ObjectID =  require('mongodb').ObjectID
JSONUtils = require 'backbone-orm/lib/json_utils'

module.exports = class DocumentAdapter_MongoId

  @id_attribute = '_id'

  @findId: (id) -> return new ObjectID("#{id}")
  @modelFindQuery: (model) -> return {_id: new ObjectID("#{model.id}")}

  @nativeToAttributes: (doc) ->
    return {} unless doc
    if doc._id
      doc.id = doc._id.toString()
      delete doc._id
    return doc

  @attributesToNative: (attributes) ->
    return {} unless attributes
    if attributes.id
      attributes._id = new ObjectID("#{attributes.id}")
      delete attributes.id
    return attributes