'use strict';

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');
const http2 = require('http2');
const { URL } = require('url');
const Countdown = require('../common/countdown');

const server = http2.createServer();
server.on('stream', common.mustCall((stream) => {
  stream.session.altsvc('h2=":8000"', stream.id);
}));
server.on('session', common.mustCall((session) => {
  // throws ERR_HTTP2_INVALID_SESSION if altsvc is called after destroy
  assert.throws(
    () => {
      session.altsvc('h2=":8000"', 3);
    },
    {
      code: 'ERR_HTTP2_INVALID_SESSION',
      name: 'Error [ERR_HTTP2_INVALID_SESSION]',
      message: 'The session has been destroyed'
    }
  );
}));

server.listen(0, common.mustCall(() => {
  const client = http2.connect(`http://localhost:${server.address().port}`);

  const req = client.request();
  req.resume();
  req.on('close', common.mustCall());
  req.session.destroy();
}));
