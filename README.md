[![js-semistandard-style](https://img.shields.io/badge/code%20style-semistandard-brightgreen.svg?style=flat-square)](https://github.com/Flet/semistandard)

# Yana

Yana is yet another node.js library for Asterisk Manager Interface.

## Installation
    $ npm install yana

## API

### Connecting

```js
var AMI = require('yana');

var ami = new AMI({
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

### Actions

``
ami.send(action, [callback])
``

Parameters:

 * ``action``: an object specifying AMI action to send to Asterisk. Keys are case insensitive.

To specify multiple keys with the same name, use an array as the value, for example
```
{
  Action: 'Originate',
  ...,
  Variable: ['var1=1', 'var2=2']
}
```
will be transformed into AMI action
```
Action: Originate
...
Variable: var1=1
Variable: var2=2
```

 * ``callback`` (optional): a function to handle response

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

### Events

AMI is an EventEmitter with the following events:
 * ``'connect'`` emitted when the client has successfully logged in
 * ``'error'`` emitted on unrecoverable errors (connection errors with reconnect turned off, unknown protocol, incorrect login)
 * ``'disconnect'`` is only emitted in reconnection mode when the client loses connection
 * ``'reconnect'`` is emitted on successful reconnection
 * ``'event'`` fires on every event sent by Asterisk
 * all events received from Asterisk are passed trasparently, you can subsribe to events by their names, eg. ``'FullyBooted'`` or ``'PeerStatus'``
 * UserEvents also trigger events like ``'UserEvent-EventName'``, where EventName is specivied in UserEvent header of AMI message

For thorough documentation on available AMI commands see [Asterisk Wiki](https://wiki.asterisk.org/wiki/display/AST/AMI+Actions).

## Example usage
```js
var util = require('util');
var AMI = require('yana');

var ami = new AMI({
  login: 'login',
  password: 'secret'
});

ami.connect(function () {
  console.log('Connected');
});

ami.on('error', function (err) {
  console.log('An error occured: ' + err);
});

ami.on('FullyBooted', function (event) {
  console.log('Ready');
  ami.send({Action: 'ListCommands'}, function (err, res) {
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
