"use strict";
var net = require('net'),
    util = require('util');

function setup_line_processor(self) {
    var buffer = "";

    function process_data(chunk) {
        var r, cur;
        buffer += chunk;
        r = buffer.split('\r\n');
        while (r.length > 1) {
            cur = r.shift();
            self.emit('line', cur);
        }
        buffer = r.shift();
    }

    function process_end() {
        if (buffer.length) {
            self.emit('line', buffer);
        }
    }

    self.on('data', function (data) { process_data(data); });
    self.on('end', function () { process_end(); });
}

function Socket(options) {
    if (!(this instanceof Socket)) { return new Socket(options); }
    net.Socket.call(this, options);
    setup_line_processor(this);
}

util.inherits(Socket, net.Socket);

exports.Socket = Socket;
// vim: ts=4 sw=4 et si
