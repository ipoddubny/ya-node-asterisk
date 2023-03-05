[![js-semistandard-style](https://img.shields.io/badge/code%20style-semistandard-brightgreen.svg)](https://github.com/Flet/semistandard)
[![Node.js CI](https://github.com/ipoddubny/ya-node-asterisk/workflows/Node.js%20CI/badge.svg)](https://github.com/ipoddubny/ya-node-asterisk/actions)

# Yana

Yana is yet another node.js library for Asterisk Manager Interface.

Supported Asterisk versions: all (tested with Asterisk 11-20).

Supported node.js versions: 12+.

- small (~350 lines of code)
- no dependencies
- low-level (AMI events and actions are processed as plain JavaScript objects)
- supports Promises/async-await
- supports AMI actions returning event lists

## Installation
    $ npm install yana

## API

### Connecting

```js
const AMI = require('yana');

const ami = new AMI({
  port: 5038,
  host: 'example.com',
  login: 'login',
  password: 'secret',
  events: 'on',
  reconnect: true
});

ami.connect(function () {
  console.log('Connected to AMI');
});
```

Constructor parameters:

 * ``host`` (optional, default: 'localhost'): host the client connects to
 * ``port`` (optional, default: 5038): port the client connects to
 * ``login``: AMI user login
 * ``password``: AMI user password
 * ``events`` (optional, default: 'on'): string specifying which AMI event classes to receive, all by default (see [Asterisk Wiki](https://wiki.asterisk.org/wiki/display/AST/Asterisk+16+ManagerAction_Events))
 * ``reconnect`` (optional, default: false): automatically reconnect on connection errors

``
ami.connect([callback])
``

Initiates a connection. When the connection is established, the 'connect' event will be emitted.
The ``callback`` parameter will be added as an once-listener for the 'connect' event.

Returns: Promise.

### Actions

``
ami.send(action, [callback])
``

Parameters:

 * ``action``: an object specifying AMI action to send to Asterisk. Keys are expected to be in lower case.

Returns: Promise.

To specify multiple keys with the same name use an array as the value, for example:
```
{
  action: 'Originate',
  ...,
  variable: ['var1=1', 'var2=2']
}
```
will be transformed into an AMI action
```
action: Originate
...
variable: var1=1
variable: var2=2
```

 * ``callback`` (optional)

callback takes 2 arguments (err, res):
 - ``err`` indicates only connection or protocol errors. If an AMI action fails, but returns a valid response, it is not considered an error.
 - ``res`` is an object representing the message received from Asterisk (keys and values depend on Asterisk).
   Keys are always converted to lower case.
   Actions returning results in multiple AMI events are collected as an ``eventlist`` key in ``res``.
   AMI results containing multiple keys of the same name are converted to objects containing one key with values collected in an array.

### Disconnecting

``
ami.disconnect([callback]);
``

Parameters:

 * ``callback`` (optional)

Returns: Promise.

### Promises

``connect``, ``send`` and ``disconnect`` return Promises and can be used with async/await without callbacks.

### Events

AMI is an EventEmitter with the following events:
 * ``'connect'`` emitted when the client has successfully logged in
 * ``'error'`` emitted on unrecoverable errors (connection errors with reconnect turned off, unknown protocol, incorrect login)
 * ``'disconnect'`` is only emitted in reconnection mode when the client loses connection
 * ``'reconnect'`` is emitted on successful reconnection
 * ``'event'`` fires on every event sent by Asterisk
 * all events received from Asterisk are passed trasparently, you can subsribe to events by their names, eg. ``'FullyBooted'`` or ``'PeerStatus'``
 * UserEvents also trigger events like ``'UserEvent-EventName'``, where EventName is specified in the UserEvent header of AMI message

For thorough documentation on AMI events see [Asterisk Wiki](https://wiki.asterisk.org/wiki/display/AST/Asterisk+18+AMI+Events).

## Example usage
```js
const AMI = require('yana');

const ami = new AMI({
  login: 'login',
  password: 'secret'
});

ami.connect(function () {
  console.log('Connected');
});

ami.on('error', function (err) {
  console.log('An error occured: ' + err);
});

ami.once('FullyBooted', function (event) {
  console.log('Ready');
  ami.send({action: 'CoreSettings'}, function (err, res) {
    console.log('CoreSettings result:', res);

    console.log('Waiting 5 seconds...');
    setTimeout(function () {
      console.log('Disconnecting...');
      ami.disconnect(function () {
        console.log('Disconnected');
      });
    }, 5000);
  });
});
```

Using Promises and async/await:
```js
const AMI = require('yana');

async function main() {
  const ami = new AMI({
    login: 'login',
    password: 'secret'
  });

  try {
    await ami.connect();
  } catch (e) {
    console.error('Failed to connect');
    process.exit(1);
  }

  console.log('Connected');

  ami.on('error', function (err) {
    console.log('An error occured: ' + err);
  });

  ami.once('FullyBooted', async function (event) {
    console.log('Ready');

    try {
      const res = ami.send({action: 'CoreSettings'});
      console.log('CoreSettings result:', res);
    } catch (e) {
      console.log('Failed to send CoreSettings');
    }

    console.log('Waiting 5 seconds...');
    await new Promise((resolve, reject) => setTimout(resolve, 5000));

    console.log('Disconnecting...');

    await ami.disconnect();

    console.log('Disconnected');
  });
}

main();
```

Look at example.js for more examples.

## License

MIT
