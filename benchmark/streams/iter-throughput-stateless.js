// Throughput benchmark: cheap fused stateless stream/iter transforms.
// Measures transform invocation overhead with minimal source/sink work.
'use strict';

const common = require('../common.js');

const bench = common.createBenchmark(main, {
  transforms: [1, 2, 4, 8],
  batches: [1e4, 1e5],
  n: [10],
}, {
  flags: ['--experimental-stream-iter'],
});

const chunk = new Uint8Array(1);
const batch = [chunk];

function makeTransforms(count) {
  const transforms = new Array(count);
  let lastOptions;

  for (let i = 0; i < count; i++) {
    transforms[i] = (chunks, options) => {
      lastOptions = options;
      if (options.signal === undefined) {
        throw new Error('missing signal');
      }
      return chunks;
    };
  }

  return { __proto__: null, transforms, getLastOptions: () => lastOptions };
}

function main({ transforms: transformCount, batches, n }) {
  const { pipeTo } = require('stream/iter');
  const { transforms, getLastOptions } = makeTransforms(transformCount);
  const writer = {
    __proto__: null,
    write() {},
    writeSync() { return true; },
  };
  const totalOps = (batches + 1) * transformCount * n;

  async function run() {
    async function* source() {
      for (let i = 0; i < batches; i++) {
        yield batch;
      }
    }

    await pipeTo(source(), ...transforms, writer);
  }

  (async () => {
    bench.start();
    for (let i = 0; i < n; i++) {
      await run();
    }
    if (getLastOptions() === undefined) {
      throw new Error('transform was not called');
    }
    bench.end(totalOps);
  })();
}
