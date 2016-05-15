'use strict';

var net = require('net');
var util = require('util');

function LineSocket (options) {
  net.Socket.call(this, options);
  this._setupLineProcessing();
}

util.inherits(LineSocket, net.Socket);

LineSocket.prototype._setupLineProcessing = function _setupLineProcessing () {
  var self = this;
  var buffer = '';

  self.on('data', function (chunk) {
    var r, cur;

    buffer += chunk;
    r = buffer.split('\r\n');
    while (r.length > 1) {
      cur = r.shift();
      self.emit('line', cur);
    }

    buffer = r.shift();
  });

  self.on('end', function () {
    if (buffer.length) {
      self.emit('line', buffer);
    }
  });
};

module.exports = LineSocket;
