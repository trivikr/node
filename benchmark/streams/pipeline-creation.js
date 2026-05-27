'use strict';

const common = require('../common.js');
const {
  PassThrough,
  Readable,
  Writable,
  pipeline,
} = require('stream');

const bench = common.createBenchmark(main, {
  n: [1e5],
  streams: [2, 3],
});

function createReadable() {
  return new Readable({
    read() {
      this.push(null);
    },
  });
}

function createWritable() {
  return new Writable({
    write(chunk, enc, cb) {
      cb();
    },
  });
}

function runTwoStream(cb) {
  pipeline(createReadable(), createWritable(), cb);
}

function runThreeStream(cb) {
  pipeline(createReadable(), new PassThrough(), createWritable(), cb);
}

function main({ n, streams }) {
  const run = streams === 2 ? runTwoStream : runThreeStream;
  let i = 0;

  bench.start();
  (function next() {
    if (i++ === n) {
      bench.end(n);
      return;
    }
    run(next);
  })();
}
