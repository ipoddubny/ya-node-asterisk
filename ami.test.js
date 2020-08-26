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

async function makeLoggedInAMI() {
  const ami = makeAMI();
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
    MLS.prototype.write.mockClear();
    MLS.prototype.end.mockClear();
  });

  test('connect and log in', async () => {
    const ami = makeAMI();

    MLS.expectAndRespondToAction(
      /action: Login\r\nusername: 123\r\nsecret: 321\r\nevents: off/,
      [
        'Response: Success'
      ]
    );

    expect(ami.connect()).resolves.toBe(undefined);
  });

  test('connect and log in, boolean events', async () => {
    const ami = makeAMI({events: true});

    MLS.expectAndRespondToAction(
      /action: Login\r\nusername: 123\r\nsecret: 321\r\nevents: on/,
      [
        'Response: Success'
      ]
    );

    expect(ami.connect()).resolves.toBe(undefined);
  });

  test('connect and log in - with callback', async (done) => {
    const ami = makeAMI();

    MLS.expectAndRespondToAction(
      /action: Login\r\nusername: 123\r\nsecret: 321\r\nevents: off/,
      [
        'Response: Success'
      ]
    );

    ami.connect(() => {
      done();
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

  test('disconnect - with callback', async (done) => {
    const ami = await makeLoggedInAMI();
    MLS.expectAndRespondToAction(
      /action: Logoff/,
      [
        'Response: Goodbye',
        'Message: Thanks for all the fish'
      ]
    );

    ami.disconnect(err => {
      expect(MLS.prototype.end).toHaveBeenCalled();
      expect(err).toBeNull();
      done();
    });
  });

  test('disconnect when not connected', async () => {
    const ami = makeAMI();

    expect(ami.disconnect()).rejects.toBeInstanceOf(Error);
  });

  test('disconnect when not connected - with callback', async (done) => {
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

    test('send action and get a response - with callback', async (done) => {
      const ami = await makeLoggedInAMI();
      MLS.expectAndRespondToAction(
        /action: Ping/,
        [
          'Response: Pong'
        ]
      );

      ami.send({action: 'Ping'}, (err, res) => {
        expect(err).toBeNull();
        expect(res).toEqual(expect.objectContaining({response: 'Pong'}));
        done();
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
    test('triggers "event" on any event', async (done) => {
      const ami = await makeLoggedInAMI();
      const eventLines = [
        'Event: TestEvent',
        'Key1: Value1',
        'Key2: Value2',
        ''
      ];

      ami.on('event', ev => {
        expect(ev).toEqual({event: 'TestEvent', key1: 'Value1', key2: 'Value2'});
        done();
      });
      ami.socket.emitManyLines(eventLines);
    });

    test('triggers <EventName> on EventName from asterisk', async (done) => {
      const ami = await makeLoggedInAMI();
      const eventLines = [
        'Event: TestEvent',
        'Key1: Value1',
        'Key2: Value2',
        ''
      ];

      ami.on('TestEvent', ev => {
        expect(ev).toEqual({event: 'TestEvent', key1: 'Value1', key2: 'Value2'});
        done();
      });
      ami.socket.emitManyLines(eventLines);
    });

    test('triggers <UserEvent-EventName> on UserEvent: EventName from asterisk', async (done) => {
      const ami = await makeLoggedInAMI();
      const eventLines = [
        'Event: UserEvent',
        'UserEvent: TestUserEvent',
        'Hello: World',
        ''
      ];

      ami.on('UserEvent-TestUserEvent', ev => {
        expect(ev).toEqual({event: 'UserEvent', userevent: 'TestUserEvent', hello: 'World'});
        done();
      });
      ami.socket.emitManyLines(eventLines);
    });
  });
});