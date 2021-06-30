jest.mock('./line-socket');
const MLS = require('./line-socket');
const AMI = require('./ami');

function makeAMI(overrides = {}) {

  const defaults = {
    host: '127.0.0.1',
    port: '5038',
    login: '123',
    password: '321',
    events: 'off',
    reconnect: false
  };

  const options = Object.assign(defaults, overrides);
  return new AMI(options);
}

async function makeLoggedInAMI(overrides) {
  const ami = makeAMI(overrides);
  MLS.expectAndRespondToAction(
    /action: Login\r\nusername: 123\r\nsecret: 321\r\nevents: off/,
    [
      'Response: Success'
    ]
  );
  await ami.connect();
  return ami;
}

describe('AMI', () => {
  beforeEach(() => {
    MLS.prototype.connect.mockClear();
    MLS.prototype.write.mockClear();
    MLS.prototype.end.mockClear();
  });

  test('connect and log in', () => {
    const ami = makeAMI();

    MLS.expectAndRespondToAction(
      /action: Login\r\nusername: 123\r\nsecret: 321\r\nevents: off/,
      [
        'Response: Success'
      ]
    );

    expect(ami.connect()).resolves.toBe(undefined);
  });

  test('connect and log in, boolean events', () => {
    const ami = makeAMI({events: true});

    MLS.expectAndRespondToAction(
      /action: Login\r\nusername: 123\r\nsecret: 321\r\nevents: on/,
      [
        'Response: Success'
      ]
    );

    expect(ami.connect()).resolves.toBe(undefined);
  });

  test('connect and log in - with callback', (done) => {
    const ami = makeAMI();

    MLS.expectAndRespondToAction(
      /action: Login\r\nusername: 123\r\nsecret: 321\r\nevents: off/,
      [
        'Response: Success'
      ]
    );

    ami.connect(done);
  });

  test('reconnect', async () => {
    const ami = await makeLoggedInAMI({reconnect: true});

    // this triggers a warning early on, but it's impossible to set a process.on('warning') in jest
    // so it's only logged to stdout, but not caught
    ami.setMaxListeners(1);

    const FAILED_CONNECTIONS = 3;

    for (let i = 0; i < FAILED_CONNECTIONS; i++) {
      MLS.prototype.connect.mockImplementationOnce(function () {
        this.emit('error');
      });
    }

    ami.socket.emit('error', new Error('test error'));

    MLS.expectAndRespondToAction(
      /action: Login\r\nusername: 123\r\nsecret: 321\r\nevents: off/,
      [
        'Response: Success'
      ]
    );

    await new Promise((resolve, reject) => {
      ami.once('reconnect', () => {
        expect(ami.rawListeners('connect')).toHaveLength(0);
        expect(ami.rawListeners('error')).toHaveLength(0);
        expect(MLS.prototype.connect).toHaveBeenCalledTimes(1 + FAILED_CONNECTIONS + 1);
        resolve();
      });
    });
  });

  test('disconnect', async () => {
    const ami = await makeLoggedInAMI();
    MLS.expectAndRespondToAction(
      /action: Logoff/,
      [
        'Response: Goodbye',
        'Message: Thanks for all the fish'
      ]
    );
    await ami.disconnect();
    expect(MLS.prototype.end).toHaveBeenCalled();
  });

  test('disconnect - with callback', async () => {
    const ami = await makeLoggedInAMI();
    MLS.expectAndRespondToAction(
      /action: Logoff/,
      [
        'Response: Goodbye',
        'Message: Thanks for all the fish'
      ]
    );

    await new Promise((resolve, reject) => {
      ami.disconnect(err => {
        expect(MLS.prototype.end).toHaveBeenCalled();
        expect(err).toBeNull();
        resolve();
      });
    });
  });

  test('disconnect when not connected', () => {
    const ami = makeAMI();

    expect(ami.disconnect()).rejects.toBeInstanceOf(Error);
  });

  test('disconnect when not connected - with callback', (done) => {
    const ami = makeAMI();
    ami.disconnect(err => {
      expect(err).toBeInstanceOf(Error);
      done();
    });
  });

  test('send action, socket error', async () => {
    const ami = await makeLoggedInAMI();

    ami.on('error', () => {});
    MLS.onWrite(function (data) {
      const self = this;
      process.nextTick(function () {
        self.emit('error', new Error('connection lost'));
      });
    });

    expect(ami.send({action: 'Ping'})).rejects.toEqual(new Error('connection lost'));
  });

  describe('actions', () => {
    test('send action and get a response', async () => {
      const ami = await makeLoggedInAMI();
      MLS.expectAndRespondToAction(
        /action: Ping/,
        [
          'Response: Pong'
        ]
      );
      const res = await ami.send({action: 'Ping'});
      expect(res).toEqual(expect.objectContaining({response: 'Pong'}));
    });

    test('send action and get a response - with callback', async () => {
      const ami = await makeLoggedInAMI();
      MLS.expectAndRespondToAction(
        /action: Ping/,
        [
          'Response: Pong'
        ]
      );

      await new Promise((resolve, reject) => {
        ami.send({action: 'Ping'}, (err, res) => {
          expect(err).toBeNull();
          expect(res).toEqual(expect.objectContaining({response: 'Pong'}));
          resolve();
        });
      });
    });

    test('send Command action and get a pre-14 response', async () => {
      const ami = await makeLoggedInAMI();
      MLS.expectAndRespondToAction(
        /action: Command/,
        [
          'Response: Follows',
          'hello\nworld\n--END COMMAND--'
        ]
      );
      const res = await ami.send({action: 'Command', command: 'show hello world'});
      expect(res).toEqual(expect.objectContaining({response: 'Follows', output: ['hello', 'world']}));
    });

    test('send action with key->multival in request', async () => {
      const ami = await makeLoggedInAMI();
      MLS.expectAndRespondToAction(
        /action: Originate\r\nvariable: a=1\r\nvariable: b=2\r\n/,
        [
          'Response: Success',
          'Message: Originate successfully queued'
        ]
      );
      const res = await ami.send({action: 'Originate', variable: ['a=1','b=2']});
      expect(res).toEqual(expect.objectContaining({response: 'Success'}));
    });

    test('send action with key->multival in response', async () => {
      const ami = await makeLoggedInAMI();
      MLS.expectAndRespondToAction(
        /action: ABC/,
        [
          'Response: Success',
          'Message: ...',
          'MultiField: a',
          'MultiField: b'
        ]
      );
      const res = await ami.send({action: 'ABC'});
      expect(res).toEqual(expect.objectContaining({response: 'Success', multifield: ['a', 'b']}));
    });

    test('send action and consume an eventlist', async () => {
      const ami = await makeLoggedInAMI();
      MLS.expectAndRespondToAction(
        /action: GetDogs/,
        [
          [
            'Response: Success',
            'Message: Dogs will follow',
            'EventList: start'
          ],
          [
            'Event: Dog',
            'Name: Belka'
          ],
          [
            'Event: Dog',
            'Name: Strelka'
          ],
          [
            'Event: GetDogsComplete',
            'EventList: Complete',
            'ListItems: 2'
          ]
        ]
      );

      const res = await ami.send({action: 'GetDogs'});

      expect(res).toEqual(expect.objectContaining({
        response: 'Success',
        message: 'Dogs will follow',
        eventlist: [
          expect.objectContaining({event: 'Dog', name: 'Belka'}),
          expect.objectContaining({event: 'Dog', name: 'Strelka'})
        ]
      }));
    });

    test('send action and consume an eventlist, old Asterisk', async () => {
      const ami = await makeLoggedInAMI();
      MLS.expectAndRespondToAction(
        /action: GetDogs/,
        [
          [
            'Response: Success',
            'Message: Dogs will follow',
            // no EventList!
          ],
          [
            'Event: Dog',
            'Name: Belka'
          ],
          [
            'Event: Dog',
            'Name: Strelka'
          ],
          [
            'Event: GetDogsComplete',
            // no EventList!
          ]
        ]
      );

      const res = await ami.send({action: 'GetDogs'});

      expect(res).toEqual(expect.objectContaining({
        response: 'Success',
        message: 'Dogs will follow',
        eventlist: [
          expect.objectContaining({event: 'Dog', name: 'Belka'}),
          expect.objectContaining({event: 'Dog', name: 'Strelka'})
        ]
      }));
    });
  });

  describe('events', () => {
    test('triggers "event" on any event', async () => {
      const ami = await makeLoggedInAMI();
      const eventLines = [
        'Event: TestEvent',
        'Key1: Value1',
        'Key2: Value2',
        ''
      ];

      await new Promise((resolve, reject) => {
        ami.on('event', ev => {
          expect(ev).toEqual({event: 'TestEvent', key1: 'Value1', key2: 'Value2'});
          resolve();
        });
        ami.socket.emitManyLines(eventLines);
      });
    });

    test('triggers <EventName> on EventName from asterisk', async () => {
      const ami = await makeLoggedInAMI();
      const eventLines = [
        'Event: TestEvent',
        'Key1: Value1',
        'Key2: Value2',
        ''
      ];

      await new Promise((resolve, reject) => {
        ami.on('TestEvent', ev => {
          expect(ev).toEqual({event: 'TestEvent', key1: 'Value1', key2: 'Value2'});
          resolve();
        });
        ami.socket.emitManyLines(eventLines);
      });
    });

    test('triggers <UserEvent-EventName> on UserEvent: EventName from asterisk', async () => {
      const ami = await makeLoggedInAMI();
      const eventLines = [
        'Event: UserEvent',
        'UserEvent: TestUserEvent',
        'Hello: World',
        ''
      ];

      await new Promise((resolve, reject) => {
        ami.on('UserEvent-TestUserEvent', ev => {
          expect(ev).toEqual({event: 'UserEvent', userevent: 'TestUserEvent', hello: 'World'});
          resolve();
        });
        ami.socket.emitManyLines(eventLines);
      });
    });
  });
});
