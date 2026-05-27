'use strict';

const common = require('../common');

const {
  Duplex,
  PassThrough,
  Readable,
  Transform,
  Writable,
  compose,
} = require('node:stream');

const bench = common.createBenchmark(main, {
  n: [1e5],
  api: ['compose', 'duplex-from'],
  side: ['readable', 'writable'],
  sync: ['yes', 'no'],
  len: [1024],
}, {
  combinationFilter({ side, sync }) {
    return side === 'writable' || sync === 'yes';
  },
});

function main({ n, api, side, sync, len }) {
  if (side === 'readable') {
    runReadable({ n, api, len });
  } else {
    runWritable({ n, api, sync, len });
  }
}

function runReadable({ n, api, len }) {
  const chunk = Buffer.allocUnsafe(len);
  let remaining = n;
  const readable = new Readable({
    read() {
      if (remaining-- > 0) {
        this.push(chunk);
      } else {
        this.push(null);
      }
    },
  });
  const stream = api === 'compose' ?
    compose(readable, new PassThrough()) :
    Duplex.from({ readable });
  let read = 0;

  bench.start();
  stream.on('data', () => {
    read++;
  });
  stream.on('end', () => {
    bench.end(read);
  });
}

function runWritable({ n, api, sync, len }) {
  const chunk = Buffer.allocUnsafe(len);
  const async = sync === 'no';
  const writable = new Writable({
    highWaterMark: 1,
    write(chunk, encoding, callback) {
      if (async) {
        process.nextTick(callback);
      } else {
        callback();
      }
    },
  });
  const stream = api === 'compose' ?
    compose(new Transform({
      transform(chunk, encoding, callback) {
        callback(null, chunk);
      },
    }), writable) :
    Duplex.from({ writable });
  let written = 0;

  bench.start();
  write();

  function write() {
    while (written < n) {
      written++;
      if (!stream.write(chunk)) {
        stream.once('drain', write);
        return;
      }
    }
    stream.end();
  }

  stream.on('finish', () => {
    bench.end(written);
  });
}
