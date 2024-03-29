'use strict';
var AbstractClientStore = require('express-brute/lib/AbstractClientStore');
var _ = require('lodash');

var KnexStore = module.exports = function (options) {
  var self = this;
  AbstractClientStore.apply(this, arguments);
  this.options = _.extend({}, KnexStore.defaults, options);

  if (this.options.knex) {
    this.knex = this.options.knex;
  } else {
    this.knex = require('knex')(KnexStore.defaultsKnex);
  }

  self.ready = self.knex.schema.hasTable(self.options.tablename).then(function (exists) {
    if (!exists) {
      return self.knex.schema.createTable(self.options.tablename, function (table) {
        table.string('key');
        table.timestamp('firstRequest');
        table.timestamp('lastRequest');
        table.timestamp('lifetime');
        table.integer('count');
      })
    }
  })
};
KnexStore.prototype = Object.create(AbstractClientStore.prototype);
KnexStore.prototype.set = function (key, value, lifetime, callback) {
  var self = this;
  lifetime = lifetime || 0;

  return self.ready.then(function () {
    return self.knex.transaction(function (trx) {
      return trx.select('*').forUpdate().from(self.options.tablename).where('key', '=', key)
      .then(function (foundKeys) {
        if (foundKeys.length == 0) {
          return trx.from(self.options.tablename)
          .insert({
            key: key,
            lifetime: (new Date(Date.now() + lifetime  * 1000)).toISOString(),
            lastRequest: value.lastRequest,
            firstRequest: value.firstRequest,
            count: value.count
          })
        } else {
          return trx(self.options.tablename)
          .where('key', '=', key)
          .update({
            lifetime: (new Date(Date.now() + lifetime  * 1000)).toISOString(),
            count: value.count,
            lastRequest: value.lastRequest
          })
        }
      })
    })
  }).asCallback(callback);
};
KnexStore.prototype.get = function (key, callback) {
  var self = this;
  return self.ready.tap(function () {
    return self.clearExpired();
  })
  .then(function () {
    return self.knex.select('*')
    .from(self.options.tablename)
    .where('key', '=', key)
  })
  .then(function (response) {
    var o = null;
    if (response[0]) {
      o = {};
      o.lastRequest = new Date(response[0].lastRequest);
      o.firstRequest = new Date(response[0].firstRequest);
      o.count = response[0].count;      
    }
    return o;
  }).asCallback(callback);
};
KnexStore.prototype.reset = function (key, callback) {
  var self = this;
  return self.ready.then(function () {
    return self.knex(self.options.tablename)
    .where('key', '=', key)
    .del()
  }).asCallback(callback);
};

KnexStore.prototype.increment = function (key, lifetime, callback) {
  var self = this;
  return self.get(key).then(function (result) {
    if (result) {
      return self.knex(self.options.tablename)
      .increment('count', 1)
      .where('key', '=', key)
    } else {
      return self.knex(self.options.tablename)
      .insert({
        key: key,
        firstRequest: (new Date()).toISOString(),
        lastRequest: (new Date()).toISOString(),
        lifetime: (new Date(Date.now() + lifetime * 1000)).toISOString(),
        count: 1
      })
    }
  }).asCallback(callback);
};

KnexStore.prototype.clearExpired = function (callback) {
  var self = this;
  return self.ready.then(function () {
    return self.knex(self.options.tablename)
    .del()
    .where('lifetime', '<', (new Date()).toISOString());
  }).asCallback(callback);
};

KnexStore.defaults = {
  tablename: 'brute'
};

KnexStore.defaultsKnex = {
  client: 'sqlite3',
  // debug: true,
  connection: {
    filename: "./brute-knex.sqlite"
  }
}
