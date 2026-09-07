// Test run({ watch: true }) does not report a failure when watch mode kills a
// running test process to restart it.
import * as common from '../common/index.mjs';
import { run } from 'node:test';
import assert from 'node:assert';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import tmpdir from '../common/tmpdir.js';
import { skipIfNoWatch } from '../common/watch.js';

skipIfNoWatch();
tmpdir.refresh();

const testFile = join(tmpdir.path, 'test.js');
const slowTestStarted = join(tmpdir.path, 'slow-test-started');
const fastTest = `
const test = require('node:test');
test('fast test');
`;
const slowTest = `
const test = require('node:test');
const { writeFileSync } = require('node:fs');
const { setTimeout } = require('node:timers/promises');
writeFileSync(${JSON.stringify(slowTestStarted)}, 'started');
test('slow test', async () => setTimeout(30_000));
`;

writeFileSync(testFile, fastTest);

let drains = 0;
let restarts = 0;
let wroteSlowTest = false;
let wroteFinalTest = false;
let completed = false;
const failures = [];
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), common.platformTimeout(10_000));
timeout.unref();
let markerInterval;

function writeFinalTestWhenSlowTestStarts() {
  if (markerInterval !== undefined) {
    return;
  }

  markerInterval = setInterval(() => {
    if (!existsSync(slowTestStarted)) {
      return;
    }

    clearInterval(markerInterval);
    markerInterval = undefined;
    wroteFinalTest = true;
    writeFileSync(testFile, fastTest);
  }, common.platformTimeout(100));
  markerInterval.unref();
}

const stream = run({
  cwd: tmpdir.path,
  watch: true,
  signal: controller.signal,
  isolation: 'process',
}).on('data', ({ type, data }) => {
  if (type === 'test:fail') {
    failures.push(data);
  }

  if (type === 'test:watch:restarted') {
    restarts++;
  }

  if (type === 'test:watch:drained') {
    drains++;

    if (!wroteSlowTest) {
      wroteSlowTest = true;
      writeFileSync(testFile, slowTest);
      writeFinalTestWhenSlowTestStarts();
      return;
    }

    if (wroteFinalTest) {
      completed = true;
      controller.abort();
    }
  }
});

// eslint-disable-next-line no-unused-vars
for await (const _ of stream);

clearTimeout(timeout);
if (markerInterval !== undefined) {
  clearInterval(markerInterval);
}

assert.strictEqual(completed, true);
assert.strictEqual(drains, 2);
assert.ok(restarts >= 2);
assert.deepStrictEqual(failures, []);
