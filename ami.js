/* jshint node:true */
"use strict";
var net = require('net');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var LineSocket = require('./line-socket').Socket;


var ST_DISCONNECTED = 0;
var ST_CONNECTED = 1;
var ST_AUTHORIZED = 2;
var ST_DISCONNECTING = 3;


var RECONNECT_MAX_DELAY = 1000;
var RECONNECT_FACTOR = 1.5;


function AMI (options) {

    EventEmitter.call(this);

    this.options = options;

    this.pendingActions = {};

    this.state = ST_DISCONNECTED;
    this.reconnectCounter = 0;

    this._connect();
}

util.inherits(AMI, EventEmitter);


AMI.prototype._connect = function _connect () {

    var self = this;

    self.socket = new LineSocket();

    self.socket.once('line', self._onFirstLine.bind(self));

    self.socket.on('error', function (err) {

        self._socketError('Socket error: ' + err.code);
    });

    self.socket.on('end', function () {

        self._socketError('Connection closed');
    });

    self.socket.connect(self.options.port || 5038, self.options.host || 'localhost');
};

AMI.prototype._socketError = function _socketError (msg) {

    var self = this;

    var prevStatus = self.status;

    self.status = ST_DISCONNECTED;

    self._clearPeriodicCleanup();

    self.socket.unref();

    if (prevStatus === ST_DISCONNECTING) {
        return;
    }

    if (prevStatus !== ST_DISCONNECTED) {
        self._backoffTimeout = 20;
        self.emit('disconnect');
    }

    if (self.options.reconnect) {
        self._backoffTimeout *= RECONNECT_FACTOR;
        if (self._backoffTimeout > RECONNECT_MAX_DELAY) {
            self._backoffTimeout = RECONNECT_MAX_DELAY;
        }
        self._reconnectTimeout = setTimeout(function () {

            delete self._reconnectTimeout;
            self._connect();
        }, self._backoffTimeout);
    } else {
        self.emit('error', msg);
    }
};

AMI.prototype._onFirstLine = function _onFirstLine (line) {

    var self = this;

    var version = line.match(/Asterisk Call Manager\/(\S+)/);
    if (version) {
        self.version = version[1];

        self.status = ST_CONNECTED;

        self._setupMessageBuffering();

        self._send({
            Action : 'Login',
            Username : self.options.login,
            Secret : self.options.password,
            Events: self.options.events || 'off'
        }, function (res) {

            if (res.Response === "Success") {

                self._setPeriodicCleanup();
                self.status = ST_AUTHORIZED;
                if (self.reconnectCounter === 0) {
                    self.emit('connect');
                } else {
                    self.emit('reconnect');
                }

                self.reconnectCounter++;
            } else {
                self.status = ST_DISCONNECTED;
                self.emit('error', res.Message);
            }
        });
    } else {
        self.socket.destroy();
        self.emit('error', 'Connection Error: server replied with unknown signature');
    }
};

AMI.prototype._setupMessageBuffering = function _setupMessageBuffering () {

    var self = this;

    var buffer = [];
    self.socket.on('line', function (line) {

        if (!line.length) {
            if (buffer.length) {
                self._processMessage(buffer);
            }
            buffer = [];
        } else {
            buffer.push(line);
        }
    });
};

AMI.prototype._processMessage = function _processMessage (msg) {

    var self = this;

    var nicemsg = {};
    msg.forEach(function (line) {

        if (line.match(/--END COMMAND--$/)) {
            // Response to 'Command' action emits the last line without colon
            // Split into array and drop "END COMMAND" line
            nicemsg.CMD = line.split('\n').slice(0, -1);
        } else {
            var res = line.match(/(.+?):\s*(.*)/);
            if (!res) {
                // ignore the wrong lines (e.g. for actions like Queues)
                return;
            }
            var property = res[1];
            var value = res[2];

            if (typeof nicemsg[property] === 'undefined') {
                nicemsg[property] = value;
            } else if (util.isArray(nicemsg[property])) {
                nicemsg[property].push(value);
            } else {
                // arrayify
                nicemsg[property] = [nicemsg[property], value];
            }
        }
    });

    if (nicemsg.Event) {
        self.emit('event', nicemsg);
        self.emit(nicemsg.Event, nicemsg);
        if (nicemsg.Event === 'UserEvent') {
            self.emit('UserEvent-' + nicemsg.UserEvent, nicemsg);
        }
    }

    if (self.pendingActions[nicemsg.ActionID]) {
        self.pendingActions[nicemsg.ActionID].callback(nicemsg);
    }
};

AMI.prototype._setPeriodicCleanup = function _setPeriodicCleanup () {

    var self = this;

    self._clearPeriodicCleanup();

    self._cleanupInterval = setInterval(function () {

        // give Asterisk some time to respond, then forget about it
        for (var i in self.pendingActions) {
            var token = self.pendingActions[i];
            token.ttl -= 1;
            if (token.ttl === 0) {
                delete self.pendingActions[i];
            }
        }
    }, 5000);
};

AMI.prototype._clearPeriodicCleanup = function _clearPeriodicCleanup () {

    var self = this;

    if (self._cleanupInterval) {
        clearInterval(self._cleanupInterval);
    }

    delete self._inverval;
};


AMI.prototype._send = function (options, callback) {

    var self = this;

    if (!options.ActionID) {
        options.ActionID = Math.floor(Math.random() * 100000000);
    }

    var actionID = options.ActionID;
    var query = "";
    for (var option in options) {
        if (util.isArray(options[option])) {
            for (var i in options[option]) {
                query += option + ": " + options[option][i] + "\r\n";
            }
        } else {
            query += option + ": " + options[option] + "\r\n";
        }
    }

    self.socket.write(query + '\r\n');

    if (typeof callback === "function") {
        self.pendingActions[options.ActionID] = {
            callback: callback,
            ttl: 2        // 10 seconds
        };
    }

    return actionID;
};

AMI.prototype.send = function (options, callback) {

    var self = this;

    if (self.status !== ST_AUTHORIZED) {
        return false;
    }

    self._send.apply(self, arguments);
};

AMI.prototype.disconnect = function (callback) {

    var self = this;

    if (self._reconnectTimeout) {
        clearTimeout(self._reconnectTimeout);
        return false;
    }

    self.send({Action: 'Logoff'}, function () {

        self._clearPeriodicCleanup();

        self.status = ST_DISCONNECTING;
        self.socket.end();

        if (typeof callback === 'function') {
            callback();
        }
    });
};

module.exports = AMI;
// vim: ts=4 sw=4 et si
