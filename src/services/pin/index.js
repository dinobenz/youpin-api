'use strict';

const pin = require('./pin-model');
const hooks = require('./hooks');

const Promise = require('bluebird');
const firebase = require('firebase');
const errors = require('feathers-errors');
const stormpath = require('express-stormpath');
const service = require('feathers-mongoose');

module.exports = function() {
  const app = this;
  const fdb = firebase.database();
  const options = {
    Model: pin,
    paginate: {
      default: 5,
      max: 25
    }
  };

  app.use('/pins', service(options));

  const pinService = app.service('/pins');

  pinService.before(hooks.before);

  pinService.after(hooks.after);
};
