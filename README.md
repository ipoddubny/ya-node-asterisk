# Yana

Yana is yet another node.js library for Asterisk Manager Interface.

Tested on Asterisk versions from 1.6.0 up to 12.

The library is still in early stage so the API may be a subject to change.

## Installation
Install with npm: `npm install yana`

## API

### Creating a new connection

```js
var AMI = require('yana');

var ami = new AMI({
    port: 5038,
    host: 'example.com',
    login: 'login',
    password: secret,
    events: 'on',
    reconnect: true
});
```

Parameters:

 * ``host`` (optional, default: 'localhost'): host the client connects to
 * ``port`` (optional, default: 5038): port the client connects to
 * ``login``: AMI user login
 * ``password``: AMI user password
 * ``events`` (optional, default: 'on'): 'on' or 'off', subscribe to AMI events or not
 * ``reconnect`` (optional, default: false) automatically reconnect on connection errors

### Disconnecting

```
ami.disconnect([callback]);
```

Parameters:

 * ``callback`` (optional)


### Events

AMI is an EventEmitter with the following events:
 * 'connect' emitted when the client has successfully logged in
 * 'error' emitted on unrecoverable errors (connection errors with reconnect turned off, unknown protocol, incorrect login)
 * 'disconnect' is only emitted in reconnection mode when the client loses connection
 * 'reconnect' is emitted on successful reconnection
 * 'event' fires on every event sent by Asterisk
 * all events received from Asterisk are passed trasparently, you can subsribe to events by their names, eg. 'FullyBooted' or 'PeerStatus'
 * UserEvents also trigger events like 'UserEvent-EventName', where EventName is specivied in UserEvent header of AMI message

For thorough documentation on available AMI commands see [Asterisk Wiki](https://wiki.asterisk.org/wiki/display/AST/AMI+Actions).

## Example:
```js
var util = require('util');
var AMI = require('yana');

var ami = new AMI({
    login: 'login',
    password: 'secret'
});

ami.on('connect', function () {
    console.log('Connected');
});

ami.on('error', function(err) {
    console.log('An error occured: ' + err);
});

ami.on('FullyBooted', function (event) {
    console.log('Ready');
    ami.send({Action: 'ListCommands'}, function (res) {
        console.log(util.inspect(res));
    });
    setTimeout(function () {
        console.log('Disconnecting...');
        ami.disconnect(function () {
            process.exit(0);
        });
    }, 5000);
});
```

Look at example.js for more examples.

## License

MIT
