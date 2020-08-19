'use strict';
const EventEmitter = require('events').EventEmitter;
const LineSocket = require('./line-socket');

const ST_NEW = 0;
const ST_CONNECTED = 1;
const ST_AUTHORIZED = 2;
const ST_DISCONNECTING = 3;
const ST_DISCONNECTED = 4;

const RECONNECT_MAX_DELAY = 1000;
const RECONNECT_FACTOR = 1.5;

const REGEX_END_COMMAND = /--END COMMAND--$/;
const REGEX_KV_LINE = /(.+?):\s*(.*)/;
const REGEX_WILL_FOLLOW = /will follow$/;
const REGEX_COMPLETE = /Complete$/;

class AMI extends EventEmitter {
  constructor (options) {
    super();
    this.options = options;
    this.pendingActions = {};
    this.state = ST_NEW;
    this.reconnectCounter = 0;
  }

  connect (cb) {
    if (this.socket) {
      this.socket.unref();
      this.socket.removeAllListeners();
    }

    this.socket = new LineSocket();

    this.socket.once('line', line => this._onFirstLine(line));

    this.socket.on('error', err => this._socketError(`Socket error: ${err.code}`, err));
    this.socket.on('end', () => this._socketError('Connection closed', null));
    this.socket.connect(this.options.port || 5038, this.options.host || 'localhost');

    if (cb) {
      this.once('connect', cb);
    }
  }

  _socketError (msg, err) {
    const prevState = this.state;
    const error = err || new Error(msg);

    this.state = ST_DISCONNECTED;
    for (const action of Object.values(this.pendingActions)) {
      action.callback(error);
    }
    this.pendingActions = {};

    this.socket.unref();

    switch (prevState) {
      case ST_NEW:
        this.emit('error', error);
        // do not attempt to reconnect, return now
        return;
      case ST_DISCONNECTING:
        // do not attempt to reconnect, return now
        return;
      case ST_CONNECTED:
      case ST_AUTHORIZED:
        this._backoffTimeout = 20;
        this.emit('disconnect');
        break;
      case ST_DISCONNECTED:
        // do nothing, already disconnected
        break;
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
      this.emit('error', error);
    }
  }

  _onFirstLine (line) {
    const version = line.match(/Asterisk Call Manager\/(\S+)/);
    if (!version) {
      this.socket.destroy();
      this.emit('error', new Error('Connection Error: server replied with unknown signature'));
      return;
    }

    this.version = version[1];
    this._parsedVersion = this.version.split('.').map(x => +x);
    const pv = this._parsedVersion;
    /* known versions:
    - 1.[01]    <= 1.8
    - 1.2       10
    - 1.3       11
    - [23].x.x  12 - 14 mixed
    - 4.x.x     15
    - 5.x.x     16
    */
    this._eventListHack = (pv[0] === 2 && pv[1] < 7) || pv[0] < 2; // Asterisk 13.2.0 / 14
    this._cmdHack = pv[0] < 4; // Asterisk 14+, but this checks for 15+, since we can't distinguish early 14 (2.8.x) from 13 (2.x.x, including 2.8.x)

    this.state = ST_CONNECTED;

    this._setupMessageBuffering();

    let events = 'on';
    if ('events' in this.options) {
      if (typeof (this.options.events) === 'boolean') {
        events = this.options.events ? 'on' : 'off';
      } else {
        events = this.options.events;
      }
    }

    this._send({
      action: 'Login',
      username: this.options.login,
      secret: this.options.password,
      events
    }, (err, res) => {
      if (err) {
        this.emit('error', err);
        return;
      }

      if (res.response === 'Success') {
        this.state = ST_AUTHORIZED;
        if (this.reconnectCounter === 0) {
          this.emit('connect');
        } else {
          this.emit('reconnect');
        }

        this.reconnectCounter++;
      } else {
        this.state = ST_DISCONNECTED;
        this.emit('error', new Error(res.Message));
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
      if (this._cmdHack && line.match(REGEX_END_COMMAND)) {
        // The Command action returns a non-standard response in Asterisk < 14
        // Split into array and drop the last line containing "END COMMAND"
        objMsg.output = line.split('\n').slice(0, -1);
        continue;
      }

      const res = line.match(REGEX_KV_LINE);
      if (!res) {
        // ignore invalid lines (e.g. for actions like Queues)
        continue;
      }

      const [, property, value] = res;
      const lproperty = property.toLowerCase();

      if (!(lproperty in objMsg)) {
        objMsg[lproperty] = value;
      } else if (Array.isArray(objMsg[lproperty])) {
        objMsg[lproperty].push(value);
      } else {
        // arrayify
        objMsg[lproperty] = [objMsg[lproperty], value];
      }
    }

    if (objMsg.event) {
      this.emit('event', objMsg);
      this.emit(objMsg.event, objMsg);
      if (objMsg.event === 'userevent') {
        this.emit('userevent-' + objMsg.userevent, objMsg);
      }
    }

    const action = this.pendingActions[objMsg.actionid];
    if (action) {
      if (objMsg.response === 'Success' && (objMsg.eventlist === 'start' || (this._eventListHack && REGEX_WILL_FOLLOW.test(objMsg.message)))) {
        objMsg.eventlist = [];
        action.result = objMsg;
      } else if (action.result) { // collecting an event list
        if (objMsg.eventlist || (this._eventListHack && REGEX_COMPLETE.test(objMsg.event))) { // this is the last message in the event list
          action.callback(null, action.result);
          delete this.pendingActions[objMsg.actionid];
        } else {
          action.result.eventlist.push(objMsg);
        }
      } else {
        action.callback(null, objMsg);
        delete this.pendingActions[objMsg.actionid];
      }
    }
  }

  _send (options, callback) {
    if (!options.actionid) {
      options.actionid = Math.floor(Math.random() * 100000000);
    }

    const actionID = options.actionid;
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
      this.pendingActions[options.actionid] = { callback };
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
      this.state = ST_DISCONNECTING;
      this.socket.end();

      if (typeof callback === 'function') {
        callback();
      }
    });
  }
}

module.exports = AMI;
