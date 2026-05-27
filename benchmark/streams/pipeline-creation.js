'use strict';

const common = require('../common.js');
const {
  PassThrough,
  Readable,
  Writable,
  pipeline,
} = require('stream');

const bench = common.createBenchmark(main, {
  kind: ['terminal', 'duplex'],
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

function runTwoDuplex(cb) {
  const src = new PassThrough({ autoDestroy: false });
  const dst = new PassThrough({ autoDestroy: false });
  pipeline(src, dst, cb);
  src.end();
  dst.resume();
}

function runThreeDuplex(cb) {
  const src = new PassThrough({ autoDestroy: false });
  const dst = new PassThrough({ autoDestroy: false });
  pipeline(src, new PassThrough({ autoDestroy: false }), dst, cb);
  src.end();
  dst.resume();
}

function main({ kind, n, streams }) {
  const run = kind === 'terminal' ?
    (streams === 2 ? runTwoStream : runThreeStream) :
    (streams === 2 ? runTwoDuplex : runThreeDuplex);
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
