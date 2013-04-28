"use strict";
var AMI = require('./ami'),
    util = require('util'),
    ami = new AMI({
      "port":       5038,
      "host":       'localhost',
      "login":      'login',
      "password":   'secret',
      "events":     'on'
    });

function print_res(res) {
    util.log('response to action: ' + util.inspect(res));
}

ami.on('connect', function () {
    ami.send({Action: 'Command', Command: 'core show uptime'}, print_res);
    util.log('connected to AMI version ' + ami.version);
});

ami.on('error', function (e) {
    util.log("Fatal error: " + e);
    process.exit(0);
});

ami.on('FullyBooted', function () {
    ami.send({
        Action: 'Command',
        Command: 'database show'
    }, print_res);
    ami.send({Action: 'SIPpeers'}, print_res);
    ami.on('event', function (ev) {
        util.log('got event ' + ev.Event);
    });
});

process.on('SIGINT', function () {
    util.log('SIGINT received, stopping');
    ami.disconnect();
    process.exit(0);
});

setTimeout(function () {
    ami.send({
        Action: 'Command',
        Command: 'sip show registry'
    }, print_res);
    ami.send({Action: 'ShowDialPlan'}, print_res);
    setTimeout(function () {
        ami.send({Action: 'SIPpeers'}, print_res);
    }, 5000);
    setInterval(function () {
        ami.send({Action: 'Ping'}, print_res);
    }, 3000);
}, 3000);

ami.on('PeerStatus', function (msg) {
    util.log('peer status: ' + util.inspect(msg));
});
