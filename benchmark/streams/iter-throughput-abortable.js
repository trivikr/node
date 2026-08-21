// Throughput benchmark measuring the per-chunk overhead of abortable
// iteration: drains the same async source with and without a live
// AbortSignal, which routes reads through yieldAbortable().
'use strict';

const common = require('../common.js');

const bench = common.createBenchmark(main, {
  signal: ['none', 'live'],
  chunks: [4096, 65536],
  chunkSize: [64 * 1024],
  n: [5],
}, {
  flags: ['--experimental-stream-iter'],
  test: {
    signal: 'live',
    chunks: 256,
    chunkSize: 1024,
    n: 1,
  },
});

function main({ signal, chunks, chunkSize, n }) {
  const { pull } = require('stream/iter');
  const chunk = new Uint8Array(chunkSize);
  const totalOps = (chunks * chunkSize * n) / (1024 * 1024); // MB

  function* source() {
    for (let i = 0; i < chunks; i++) {
      yield chunk;
    }
  }

  const useSignal = signal === 'live';
  const ac = useSignal ? new AbortController() : undefined;

  (async () => {
    bench.start();
    for (let i = 0; i < n; i++) {
      // pull() wraps the source in yieldAbortable() when a signal is given,
      // so each read races against the shared abort promise.
      const iterable = ac ?
        pull(source(), { signal: ac.signal }) :
        pull(source());
      let seen = 0;
      for await (const batch of iterable) {
        seen += batch.length;
      }
      if (seen !== chunks) {
        throw new Error('unexpected chunk count');
      }
    }
    bench.end(totalOps);
  })();
}
