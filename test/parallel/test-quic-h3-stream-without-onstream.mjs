// Flags: --experimental-quic --experimental-stream-iter --no-warnings

// Test: incoming stream consumer checks.
// An incoming stream must not be destroyed just because `onstream` is
// not set: on a session whose application supports headers (HTTP/3),
// a session-level `onheaders` callback is a consumer and the stream must
// be kept and driven by the application layer.
// Refs: https://github.com/nodejs/node/issues/64192
//
// A session with no stream consumers at all still destroys incoming
// streams (and emits a warning), so unconsumed streams cannot
// accumulate and hold flow control credit.
//
// The set of session-level stream callbacks is read back from the API, so a
// newly added callback fails this test until it is classified below as a
// consumer or a non-consumer.

import { hasQuic, skip, mustCall, mustNotCall } from '../common/index.mjs';
import assert from 'node:assert';
import * as fixtures from '../common/fixtures.mjs';

if (!hasQuic) {
  skip('QUIC is not enabled');
}

const { listen, connect, QuicStream } = await import('node:quic');
const { createPrivateKey } = await import('node:crypto');
const { text } = await import('stream/iter');

const key = createPrivateKey(fixtures.readKey('agent1-key.pem'));
const cert = fixtures.readKey('agent1-cert.pem');

// The consumer warning must never fire in the first block (onheaders is
// a consumer) and must fire in the second (no runnable consumer).
// common.expectWarning is not usable here: importing node:quic emits
// ExperimentalWarning, which it would reject as unexpected.
const kWarning =
  'A new stream was received but no stream consumer callback was provided';
function failOnConsumerWarning(warning) {
  assert.notStrictEqual(warning.message, kWarning);
}

// Session-level stream callbacks that count as a consumer: the negotiated
// application is guaranteed to hand every incoming stream to these, so a
// stream survives with only one of them registered, and each needs a case
// below. The rest cannot be relied on to expose an incoming request stream:
// `oninfo` is 1xx-only, `ontrailers` depends on the peer sending trailers,
// and `onwanttrailers` is an outbound notification.
const kConsumerCallbacks = ['onheaders'];
const kNonConsumerCallbacks = ['oninfo', 'ontrailers', 'onwanttrailers'];

// --- Every session-level stream callback is classified above ---
// The callbacks the implementation applies to an incoming stream are read
// back from the API: every `on*` accessor of QuicStream is offered to
// listen(), and the ones that arrive set on the received stream are the
// session-level stream callbacks. A newly added callback therefore fails
// here until it is classified.
//
// This assumes a session-level stream callback is exposed as an accessor on
// QuicStream.prototype, which holds because the callbacks are stored on a
// private field and [kNewStream] applies the defaults by assigning
// stream[name]. One added as a plain own property of the instance instead
// would not be discovered here.
{
  const candidates = Object.getOwnPropertyNames(QuicStream.prototype)
    .filter((name) => name.startsWith('on'));
  const probes = { __proto__: null };
  for (const name of candidates) probes[name] = () => {};

  const applied = Promise.withResolvers();
  const serverEndpoint = await listen(mustCall((session) => {
    session.onerror = () => {};
  }), {
    sni: { '*': { keys: [key], certs: [cert] } },
    ...probes,
    // With onstream set the stream is kept whatever the classification is,
    // so this session only observes the applied defaults.
    onstream: mustCall((stream) => {
      applied.resolve(
        candidates.filter((name) => typeof stream[name] === 'function'));
    }),
  });

  const clientSession = await connect(serverEndpoint.address, {
    servername: 'localhost',
    verifyPeer: 'manual',
  });
  clientSession.onerror = () => {};
  await clientSession.opened;
  await clientSession.createBidirectionalStream({
    headers: {
      ':method': 'GET',
      ':path': '/test',
      ':scheme': 'https',
      ':authority': 'localhost',
    },
  });

  assert.deepStrictEqual(
    (await applied.promise).sort(),
    [...kConsumerCallbacks, ...kNonConsumerCallbacks].sort(),
    'The session-level stream callbacks changed. Classify each one: a ' +
    'callback the application is guaranteed to hand every incoming stream ' +
    'to belongs in kConsumerCallbacks, must be accepted by ' +
    'QuicSession#hasStreamConsumer, and needs a case asserting a stream ' +
    'survives with only it registered. Anything else belongs in ' +
    'kNonConsumerCallbacks, which asserts the stream is destroyed with the ' +
    'consumer warning.');

  clientSession.destroy();
  await clientSession.closed;
  await serverEndpoint.destroy();
}

// --- An h3 request completes with only session-level stream callbacks ---
{
  process.on('warning', failOnConsumerWarning);
  const serverDone = Promise.withResolvers();

  // Note: no `onstream` callback anywhere on this session.
  const serverEndpoint = await listen(mustCall((serverSession) => {
    serverSession.onerror = () => {};
  }), {
    sni: { '*': { keys: [key], certs: [cert] } },
    onheaders: mustCall(function(headers) {
      assert.strictEqual(headers[':path'], '/test');
      this.sendHeaders({
        ':status': '200',
        'content-type': 'text/plain',
      });
      const w = this.writer;
      w.writeSync('kept without onstream');
      w.endSync();
      serverDone.resolve();
    }),
  });

  const clientSession = await connect(serverEndpoint.address, {
    servername: 'localhost',
    verifyPeer: 'manual',
  });
  await clientSession.opened;

  const headersReceived = Promise.withResolvers();
  const stream = await clientSession.createBidirectionalStream({
    headers: {
      ':method': 'GET',
      ':path': '/test',
      ':scheme': 'https',
      ':authority': 'localhost',
    },
    onheaders: mustCall((headers) => {
      assert.strictEqual(headers[':status'], 200);
      headersReceived.resolve();
    }),
  });

  await headersReceived.promise;
  const body = await text(stream);
  assert.strictEqual(body, 'kept without onstream');

  await serverDone.promise;
  await clientSession.close();
  await serverEndpoint.close();
  process.off('warning', failOnConsumerWarning);
}

// --- Callbacks that cannot expose every incoming h3 stream are not consumers ---
// Without onstream or onheaders, the application has no reliable way to
// obtain the incoming request stream, so it must still be destroyed with the
// consumer warning.
for (const callbackName of kNonConsumerCallbacks) {
  let consumerWarnings = 0;
  function onWarning(warning) {
    if (warning.message === kWarning) consumerWarnings++;
  }
  process.on('warning', onWarning);

  let serverSession;
  const serverEndpoint = await listen(mustCall((session) => {
    serverSession = session;
    session.onerror = () => {};
  }), {
    sni: { '*': { keys: [key], certs: [cert] } },
    // This is only a bounded fallback for the broken behavior. When the
    // consumer check works, the stream is destroyed immediately instead.
    streamIdleTimeout: 100,
    [callbackName]: mustNotCall(),
  });

  const clientSession = await connect(serverEndpoint.address, {
    servername: 'localhost',
    verifyPeer: 'manual',
  });
  clientSession.onerror = () => {};
  await clientSession.opened;

  await clientSession.createBidirectionalStream({
    headers: {
      ':method': 'GET',
      ':path': '/test',
      ':scheme': 'https',
      ':authority': 'localhost',
    },
  });

  // Give either the immediate consumer gate or the bounded fallback idle
  // timeout enough time to run before inspecting the warning and stats.
  await new Promise((resolve) => setTimeout(resolve, 300));

  try {
    assert.ok(
      consumerWarnings > 0,
      `${callbackName} must not count as an incoming stream consumer`);
    assert.strictEqual(
      Number(serverSession.stats.streamsIdleTimedOut),
      0);
  } finally {
    process.off('warning', onWarning);
    clientSession.destroy();
    await clientSession.closed;
    await serverEndpoint.destroy();
  }
}

// --- Stream callbacks that cannot run are not a consumer ---
// On a session whose negotiated application does not support headers,
// registered session-level stream callbacks can never fire, so an
// incoming stream with no onstream callback is destroyed with the
// warning. The h3 block above must not trigger that warning.
{
  // Awaiting warned.promise is the assertion: the test times out if the
  // warning never fires.
  const warned = Promise.withResolvers();
  process.on('warning', function onWarning(warning) {
    if (warning.message === kWarning) {
      process.off('warning', onWarning);
      warned.resolve();
    }
  });

  // The onheaders callback is registered but the ALPN is not h3,
  // so it can never run.
  const serverEndpoint = await listen(mustCall((serverSession) => {
    serverSession.onerror = () => {};
  }), {
    sni: { '*': { keys: [key], certs: [cert] } },
    alpn: ['test-proto'],
    onheaders: () => {},
  });

  const clientSession = await connect(serverEndpoint.address, {
    servername: 'localhost',
    alpn: 'test-proto',
    verifyPeer: 'manual',
  });
  await clientSession.opened;

  const stream = await clientSession.createUnidirectionalStream();
  stream.writer.writeSync('x');

  await warned.promise;
  await clientSession.close();
  await serverEndpoint.close();
}
