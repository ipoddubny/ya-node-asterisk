'use strict';
var AMI = require('./ami');
var util = require('util');

var ami = new AMI({
  port: 5038,
  host: 'localhost',
  login: 'login',
  password: 'secret',
  events: 'on'
});

function printRes (err, res) {
  if (err) {
    console.log('action failed', err);
    return;
  }

  console.log('response to action: ' + util.inspect(res));
}

ami.connect(function () {
  ami.send({ Action: 'Command', Command: 'core show uptime' }, printRes);
  console.log('connected to AMI version ' + ami.version);
});

ami.on('error', function (e) {
  console.log('Fatal error: ', e);
  process.exit(255);
});

ami.on('FullyBooted', function () {
  ami.send({
    Action: 'Command',
    Command: 'database show'
  }, printRes);
  ami.send({ Action: 'SIPpeers' }, printRes);
  ami.on('event', function (ev) {
    console.log('got event ' + ev.Event);
  });
});

process.on('SIGINT', function () {
  console.log('SIGINT received, stopping');
  ami.disconnect();
  process.exit(0);
});

setTimeout(function () {
  ami.send({
    Action: 'Command',
    Command: 'sip show registry'
  }, printRes);
  ami.send({ Action: 'ShowDialPlan' }, printRes);
  setTimeout(function () {
    ami.send({ Action: 'SIPpeers' }, printRes);
  }, 5000);
  setInterval(function () {
    ami.send({ Action: 'Ping' }, printRes);
  }, 3000);
}, 3000);

ami.on('PeerStatus', function (msg) {
  console.log('peer status: ' + util.inspect(msg));
});
