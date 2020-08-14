'use strict';
const EventEmitter = require('events').EventEmitter;
const LineSocket = require('./line-socket');

const ST_DISCONNECTED = 0;
const ST_CONNECTED = 1;
const ST_AUTHORIZED = 2;
const ST_DISCONNECTING = 3;

const RECONNECT_MAX_DELAY = 1000;
const RECONNECT_FACTOR = 1.5;

class AMI extends EventEmitter {
  constructor (options) {
    super();
    this.options = options;
    this.pendingActions = {};
    this.state = ST_DISCONNECTED;
    this.reconnectCounter = 0;
  }

  connect (cb) {
    if (this.socket) {
      this.socket.unref();
      this.socket.removeAllListeners();
    }

    this.socket = new LineSocket();

    this.socket.once('line', line => this._onFirstLine(line));

    this.socket.on('error', err => this._socketError(`Socket error: ${err.code}`));
    this.socket.on('end', () => this._socketError('Connection closed'));
    this.socket.connect(this.options.port || 5038, this.options.host || 'localhost');

    if (cb) {
      this.once('connect', cb);
    }
  }

  _socketError (msg) {
    const prevState = this.state;

    this.state = ST_DISCONNECTED;

    this._clearPeriodicCleanup();

    this.socket.unref();

    if (prevState === ST_DISCONNECTING) {
      return;
    }

    if (prevState !== ST_DISCONNECTED) {
      this._backoffTimeout = 20;
      this.emit('disconnect');
    }

    if (this.options.reconnect) {
      this._backoffTimeout *= RECONNECT_FACTOR;
      if (this._backoffTimeout > RECONNECT_MAX_DELAY) {
        this._backoffTimeout = RECONNECT_MAX_DELAY;
      }

      this._reconnectTimeout = setTimeout(() => {
        delete this._reconnectTimeout;
        this.connect();
      }, this._backoffTimeout);
    } else {
      this.emit('error', msg);
    }
  }

  _onFirstLine (line) {
    const version = line.match(/Asterisk Call Manager\/(\S+)/);
    if (!version) {
      this.socket.destroy();
      this.emit('error', 'Connection Error: server replied with unknown signature');
      return;
    }

    this.version = version[1];

    this.state = ST_CONNECTED;

    this._setupMessageBuffering();

    var eventsOff = this.options.events === false || this.options.events === 'off';

    this._send({
      Action: 'Login',
      Username: this.options.login,
      Secret: this.options.password,
      Events: (eventsOff ? 'off' : 'on')
    }, res => {
      if (res.Response === 'Success') {
        this._setPeriodicCleanup();
        this.state = ST_AUTHORIZED;
        if (this.reconnectCounter === 0) {
          this.emit('connect');
        } else {
          this.emit('reconnect');
        }

        this.reconnectCounter++;
      } else {
        this.state = ST_DISCONNECTED;
        this.emit('error', res.Message);
      }
    });
  }

  _setupMessageBuffering () {
    let buffer = [];
    this.socket.on('line', line => {
      if (!line.length) {
        if (buffer.length) {
          this._processMessage(buffer);
        }

        buffer = [];
      } else {
        buffer.push(line);
      }
    });
  }

  _processMessage (rawMsg) {
    const objMsg = {};
    for (const line of rawMsg) {
      if (line.match(/--END COMMAND--$/)) {
        // The Command action returns a non-standard response
        // Split into array and drop the last line containing "END COMMAND"
        objMsg.CMD = line.split('\n').slice(0, -1);
        continue;
      }

      const res = line.match(/(.+?):\s*(.*)/);
      if (!res) {
        // ignore invalid lines (e.g. for actions like Queues)
        continue;
      }

      const [, property, value] = res;

      if (!(property in objMsg)) {
        objMsg[property] = value;
      } else if (Array.isArray(objMsg[property])) {
        objMsg[property].push(value);
      } else {
        // arrayify
        objMsg[property] = [objMsg[property], value];
      }
    }

    if (objMsg.Event) {
      this.emit('event', objMsg);
      this.emit(objMsg.Event, objMsg);
      if (objMsg.Event === 'UserEvent') {
        this.emit('UserEvent-' + objMsg.UserEvent, objMsg);
      }
    }

    const action = this.pendingActions[objMsg.ActionID];
    if (action) {
      action.callback(objMsg);
    }
  }

  _setPeriodicCleanup () {
    this._clearPeriodicCleanup();

    this._cleanupInterval = setInterval(() => {
      // give Asterisk some time to respond, then forget about it
      for (const [actionID, action] of Object.entries(this.pendingActions)) {
        action.ttl -= 1;
        if (action.ttl === 0) {
          delete this.pendingActions[actionID];
        }
      }
    }, 5000);
  }

  _clearPeriodicCleanup () {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
    }

    delete this._inverval;
  }

  _send (options, callback) {
    if (!options.ActionID) {
      options.ActionID = Math.floor(Math.random() * 100000000);
    }

    const actionID = options.ActionID;
    let query = '';
    for (const [key, val] of Object.entries(options)) {
      if (Array.isArray(val)) {
        for (const v of val) {
          query += `${key}: ${v}\r\n`;
        }
      } else {
        query += `${key}: ${val}\r\n`;
      }
    }

    this.socket.write(query + '\r\n');

    if (typeof callback === 'function') {
      this.pendingActions[options.ActionID] = {
        callback: callback,
        ttl: 2 // 10 seconds
      };
    }

    return actionID;
  }

  send (options, callback) {
    if (this.state !== ST_AUTHORIZED) {
      return false;
    }

    this._send.apply(this, arguments);
  }

  disconnect (callback) {
    if (this._reconnectTimeout) {
      clearTimeout(this._reconnectTimeout);
      return false;
    }

    this.send({ Action: 'Logoff' }, () => {
      this._clearPeriodicCleanup();

      this.state = ST_DISCONNECTING;
      this.socket.end();

      if (typeof callback === 'function') {
        callback();
      }
    });
  }
}

module.exports = AMI;
