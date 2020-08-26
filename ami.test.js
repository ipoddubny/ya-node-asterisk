jest.mock('./line-socket');
const MLS = require('./line-socket');
const AMI = require('./ami');

function makeAMI() {
  return new AMI({
    host: '127.0.0.1',
    port: '5038',
    login: '123',
    password: '321',
    events: 'off',
    reconnect: false
  });
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
  test('connect and log in', async () => {
    const ami = makeAMI();

    MLS.expectAndRespondToAction(
      /action: Login\r\nusername: 123\r\nsecret: 321\r\nevents: off/,
      [
        'Response: Success'
      ]
    );

    const cb = jest.fn();
    await ami.connect(cb);
    expect(cb).toHaveBeenCalled();
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
    const cb = jest.fn(err => {
      expect(err).toBeNull();
    });
    await ami.disconnect(cb);
    expect(cb).toHaveBeenCalled();
    expect(MLS.prototype.end).toHaveBeenCalled();
  });

  test('disconnect when not connected', async () => {
    const ami = makeAMI();
    const cb = jest.fn(err => expect(err).toBeInstanceOf(Error));
    await ami.disconnect(cb);
    expect(cb).toHaveBeenCalled();
  });

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
});