// Throughput benchmark: collect stream/iter sources as text.
// Measures text() and textSync() consumer overhead for large byte workloads.
'use strict';

const common = require('../common.js');

const bench = common.createBenchmark(main, {
  api: ['async', 'sync'],
  datasize: [1024 * 1024, 16 * 1024 * 1024, 64 * 1024 * 1024],
  chunkSize: [64 * 1024],
  kind: ['ascii', 'multibyte'],
  n: [5],
}, {
  flags: ['--experimental-stream-iter'],
  test: {
    chunkSize: 64,
    datasize: 1024,
    n: 1,
  },
});

const MULTIBYTE_FILL = 'Blåbærsyltetøy';

function createChunks(datasize, chunkSize, kind) {
  let data;
  let expectedLength;

  switch (kind) {
    case 'ascii':
      data = Buffer.alloc(datasize, 'a');
      expectedLength = data.length;
      break;
    case 'multibyte': {
      const fillLength = Buffer.byteLength(MULTIBYTE_FILL);
      const value = MULTIBYTE_FILL.repeat(Math.ceil(datasize / fillLength));
      data = Buffer.from(value);
      expectedLength = value.length;
      break;
    }
  }

  const chunks = [];
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    chunks.push(data.subarray(offset, offset + chunkSize));
  }

  return { __proto__: null, chunks, expectedLength, totalBytes: data.length };
}

async function main({ api, datasize, chunkSize, kind, n }) {
  const { text, textSync } = require('stream/iter');
  const { chunks, expectedLength, totalBytes } =
    createChunks(datasize, chunkSize, kind);
  const totalOps = (totalBytes * n) / (1024 * 1024);

  switch (api) {
    case 'async':
      bench.start();
      for (let i = 0; i < n; i++) {
        const result = await text(chunks);
        if (result.length !== expectedLength) {
          throw new Error('Invalid decoded text length');
        }
      }
      bench.end(totalOps);
      break;
    case 'sync':
      bench.start();
      for (let i = 0; i < n; i++) {
        const result = textSync(chunks);
        if (result.length !== expectedLength) {
          throw new Error('Invalid decoded text length');
        }
      }
      bench.end(totalOps);
      break;
  }
}
