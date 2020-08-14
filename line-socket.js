'use strict';

var net = require('net');

class LineSocket extends net.Socket {
  constructor (options) {
    super(options);
    this._setupLineProcessing();
  }

  _setupLineProcessing () {
    let buffer = '';

    this.on('data', chunk => {
      buffer += chunk;
      const r = buffer.split('\r\n');
      while (r.length > 1) {
        const cur = r.shift();
        this.emit('line', cur);
      }

      buffer = r.shift();
    });

    this.on('end', () => {
      if (buffer.length) {
        this.emit('line', buffer);
      }
    });
  }
}

module.exports = LineSocket;
