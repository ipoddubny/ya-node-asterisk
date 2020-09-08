'use strict';
const EventEmitter = require('events').EventEmitter;
const LineSocket = require('./line-socket');

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
    this._onceConnected = false;
    this._connected = false;
    this._disconnected = false;
  }

  _connect() {
    if (this.socket) {
      this.socket.unref();
      this.socket.removeAllListeners();
    }

    this._disconnected = false;

    this.socket = new LineSocket();

    this.socket.once('line', line => this._onFirstLine(line));

    this.socket.on('error', err => this._socketError(err));
    this.socket.on('end', () => this._socketError(new Error('Connection closed')));
    this.socket.connect(this.options.port || 5038, this.options.host || 'localhost');
  }

  connect (cb) {
    this._connect();

    const promise = new Promise((resolve, reject) => {
      const onConnect = () => { console.log('once connect fired'); this.removeListener('error', onError); resolve(); };
      const onError = err => { console.log('once error fired'); this.removeListener('connect', onConnect); reject(err); };
      console.log('adding  listeners for connect and error');
      this.once('connect', onConnect);
      this.once('error', onError);
    });

    if (cb) {
      promise.then(cb);
    }

    return promise;
  }

  _socketError (err) {
    this.socket.unref();

    for (const action of Object.values(this.pendingActions)) {
      action.callback(err);
    }
    this.pendingActions = {};

    const prevConnected = this._connected;
    this._connected = false;
    if (this._disconnected) {
      // it's ok, we're disconnected
      return;
    }

    if (!this._onceConnected) {
      // never connected before => stop it now
      this.emit('error', err);
      return;
    }

    if (prevConnected === true) {
      // lost connection just now
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
        this._connect();
      }, this._backoffTimeout);
    } else {
      this.emit('error', err);
    }
  }

  _onFirstLine (line) {
    const version = line.match(/Asterisk Call Manager\/(\S+)/);
    if (!version) {
      this.socket.destroy(new Error('Connection Error: server replied with unknown signature'));
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
        this._connected = true;
        this.emit(this._onceConnected ? 'reconnect' : 'connect');
        this._onceConnected = true;
      } else {
        this.socket.destroy(new Error(`Login failed: ${res.message}`));
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
      if (objMsg.event === 'UserEvent') {
        this.emit('UserEvent-' + objMsg.userevent, objMsg);
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

    const promise = new Promise((resolve, reject) => {
      this.pendingActions[options.actionid] = {
        callback: (err, res) => {
          if (err) {
            reject(err);
            return;
          }

          resolve(res);
        }
      };
    });

    if (typeof (callback) === 'function') {
      promise
        .catch(err => callback(err))
        .then(res => callback(null, res));
    }

    return promise;
  }

  send (options, callback) {
    if (!this._connected) {
      if (typeof (callback) === 'function') {
        // don't do it immediately, never call callback on the same tick
        process.nextTick(() => callback(new Error('not connected')));
      }

      return Promise.reject(new Error('not connected'));
    }

    return this._send.apply(this, arguments);
  }

  disconnect (callback) {
    if (this._reconnectTimeout) {
      clearTimeout(this._reconnectTimeout);
      return false;
    }

    return this.send({ action: 'Logoff' })
      .then(() => {
        this._disconnected = true;
        this.socket.end();

        if (typeof callback === 'function') {
          callback(null);
        }
      })
      .catch(err => {
        if (typeof callback === 'function') {
          callback(err);
        } else {
          throw err;
        }
      });
  }
}

module.exports = AMI;
