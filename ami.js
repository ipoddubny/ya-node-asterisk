"use strict";
var net = require('net');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var LineSocket = require('./line-socket').Socket;

function debug(line) { }
//function debug(line) { util.log(line) }

function setup_message_socket(self) {
    var buffer = [];
    self.socket.on('line', function (line) {
        debug("line: " + line + " (" + line.length + ")");
        if (!line.length) {
            self.emit('_message', buffer);
            buffer = [];
        } else {
            buffer.push(line);
        }
    });
}

function AMI(params) {
    if (!(this instanceof AMI)) { return new AMI(params); }
    EventEmitter.call(this);

    this.port = params.port;
    this.host = params.host;
    this.login = params.login;
    this.password = params.password;
    this.events = params.events;

    this.socket = new LineSocket();
    this.pending_actions = {};

    var self = this;

    function on_first_line(line) {
        var version,
            loginmsg;
        version = line.match(/Asterisk Call Manager\/([12]\.[0123])/);
        if (version) {
            self.version = version[1];
            debug('successfully connected to AMI');
            setup_message_socket(self);
            loginmsg = {
                Action : 'Login',
                Username : self.login,
                Secret : self.password,
            };
            if (self.events) {
                loginmsg.Events = self.events;
            }
            self.send(loginmsg, function (res) {
                if (res.Response === "Success") {
                    self.emit('connect');
                } else {
                    self.emit('error', res.Message);
                }
            });
        } else {
            self.socket.destroy();
            self.emit('error', 'Connection Error: server replied with unknown signature');
        }
    }

    this.on('_message', function (msg) {
        var nicemsg = {};
        msg.forEach(function (line) {
            var res,
                property,
                value;
            if (line.match(/--END COMMAND--$/)) {
                // Response to 'Command' action emits the last line without colon
                // Split into array and drop "END COMMAND" line
                nicemsg.CMD = line.split('\n').slice(0, -1);
            } else {
                res = line.match(/(.*?):\s*(.*)/);
                property = res[1];
                value = res[2];
                if (typeof nicemsg[property] === 'undefined') {
                    nicemsg[property] = value;
                } else if (util.isArray(nicemsg[property])) {
                    nicemsg.push(value);
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
        if (self.pending_actions[nicemsg.ActionID]) {
            self.pending_actions[nicemsg.ActionID].callback(nicemsg);
        }
    });

    // give Asterisk some time to respond, then forget about it
    setInterval(function () {
        var i, token;
        for (i in self.pending_actions) {
            token = self.pending_actions[i];
            token.ttl -= 1;
            if (token.ttl === 0) {
                delete self.pending_actions[i];
            }
        }
    }, 5000);

    this.socket.once('line', function (line) {
        on_first_line(line);
    });

    this.socket.on('error', function (err) {
        self.emit('error', 'Socket error: ' + err.code);
    });

    this.socket.on('end', function () {
        self.emit('error', 'Connection closed');
    });

    this.socket.connect(this.port, this.host);
}

util.inherits(AMI, EventEmitter);


AMI.prototype.send = function (options, cb) {
    var self = this,
        actionID,
        query = "",
        option,
        i,
        waiting;
    if (!options.ActionID) {
        options.ActionID = Math.floor(Math.random() * 100000000);
    }
    actionID = options.ActionID;
    for (option in options) {
        if (util.isArray(options[option])) {
            for (i in options[option]) {
                query += option + ": " + options[option][i] + "\r\n";
            }
        } else {
            query += option + ": " + options[option] + "\r\n";
        }
    }
    debug('sending action: ' + query);
    this.socket.write(query + '\r\n');
    if (typeof cb === "function") {
        waiting = {};
        waiting.callback = cb;
        waiting.ttl = 2; // 10 seconds
        self.pending_actions[options.ActionID] = waiting;
    }
    return actionID;
};


AMI.prototype.disconnect = function () {
    var self = this;
    debug('AMI.disconnect called, closing connection');
    this.send({Action: 'Logoff'}, function () {
        self.socket.end();
    });
};


module.exports = AMI;
// vim: ts=4 sw=4 et si
