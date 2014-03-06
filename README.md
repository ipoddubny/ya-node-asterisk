# Yana

Yana is yet another node.js library for Asterisk Manager Interface.

Tested on Asterisk versions from 1.6.0 up to 12.

The library is still in early stage so the API may be a subject to change.

## Installation
Install with npm: `npm install yana`

## API
Connecting is as simple as this:
```js
var AMI = require('yana'),
    ami = new AMI({
      port: 5038,
      host: 'example.com',
      login: 'login',
      password: secret,
      events: 'on'
    });
```

AMI is an EventEmitter and so it emits events of a few kinds:
 * 'connect' fires upon successful login
 * 'error' fires on any connection related errors
 * 'event' fires on every event sent by Asterisk
It is possible to suscribe to specific Asterisk events by their names like 'FullyBooted' or 'PeerStatus'.
UserEvents also trigger events like 'UserEvent-EventName'.

For thorough documentation on available AMI commands check [Asterisk Wiki](https://wiki.asterisk.org/wiki/display/AST/AMI+Actions).

## Example:
```js
var util = require('util'),
    AMI = require('yana'),
    ami = new AMI({
        port: 5038,
        host: 'localhost',
        login: 'login',
        password: 'secret',
        events: 'on'
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
        ami.disconnect();
        process.exit(0);
    }, 5000);
});
```

Look at example.js for more exaples.

## License

Copyright (c) Ivan Poddubny

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

