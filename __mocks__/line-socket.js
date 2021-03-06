const EventEmitter = require('events').EventEmitter;

class MockLineSocket extends EventEmitter {
  unref() {}
  destroy(err) {
    if (err) {
      this.emit('error', err);
    }
  }

  emitManyLines(arr) {
    for (const line of arr) {
      this.emit('line', line);
    }
  }
}

MockLineSocket.prototype.connect = jest.fn(function () {
  this.emit('connect');
  this.emit('line', 'Asterisk Call Manager/1.2.3');
});

const writer = MockLineSocket.prototype.write = jest.fn();
MockLineSocket.prototype.end = jest.fn();

MockLineSocket.onWrite = function onWrite(fn) {
  writer.mockImplementationOnce(fn);
}

MockLineSocket.expectAndRespondToAction = function expectAndRespondToAction (regex, response) {
  MockLineSocket.onWrite(function (data) {
    const self = this;
    process.nextTick(function () {
      expect(data).toMatch(regex);

      const actionID = data.match(/actionid: (\S+)/)[1];

      if (!Array.isArray(response[0])) {
        response = [response];
      }

      const lines = [];

      for (const msg of response) {
        lines.push(`ActionID: ${actionID}`);
        for (const line of msg) {
          lines.push(line);
        }
        lines.push('');
      }

      for (const line of lines) {
        self.emit('line', line);
      }
    })
  });
}

module.exports = MockLineSocket;