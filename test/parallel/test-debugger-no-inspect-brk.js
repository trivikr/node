// This tests that child options cannot disable the startup break required by
// the debugger handshake.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const fixtures = require('../common/fixtures');
const {
  spawnSyncAndAssert,
  spawnSyncAndExit,
} = require('../common/child_process');
const { assertProbeJson } = require('../common/debugger-probe');

const cwd = fixtures.path('debugger');
const probeUrl = fixtures.fileURL('debugger', 'probe.js').href;
const incompatible = /--no-inspect-brk` is incompatible with `node inspect/;

function assertSuccessfulProbe(output) {
  assertProbeJson(output, {
    v: 2,
    probes: [{
      expr: 'finalValue',
      target: { suffix: 'probe.js', line: 12 },
    }],
    results: [{
      probe: 0,
      event: 'hit',
      hit: 1,
      location: { url: probeUrl, line: 12, column: 1 },
      result: { type: 'number', value: 81, description: '81' },
    }, {
      event: 'completed',
    }],
  });
}

spawnSyncAndExit(process.execPath, [
  'inspect',
  '--port=0',
  '--require', 'assert',
  '--no-inspect-brk',
  '-e', 'setInterval(() => {}, 1000)',
], { cwd }, {
  signal: null,
  status: 1,
  stderr: incompatible,
  trim: true,
});

spawnSyncAndExit(process.execPath, [
  'inspect',
  '--json',
  '--timeout=50',
  '--probe', 'probe.js:12',
  '--expr', 'finalValue',
  '--',
  '--require', 'assert',
  '--no-inspect-brk',
  'probe.js',
], { cwd }, {
  signal: null,
  status: 1,
  stderr: incompatible,
  trim: true,
});

// A later --inspect-brk restores the startup wait, following normal Node.js
// option precedence.
spawnSyncAndAssert(process.execPath, [
  'inspect',
  '--json',
  '--probe', 'probe.js:12',
  '--expr', 'finalValue',
  '--',
  '--no-inspect-brk',
  '--inspect-brk=0',
  'probe.js',
], { cwd }, {
  stdout: assertSuccessfulProbe,
  trim: true,
});

// The same text remains valid when it is an argument to the debuggee rather
// than a Node.js option.
spawnSyncAndAssert(process.execPath, [
  'inspect',
  '--json',
  '--probe', 'probe.js:12',
  '--expr', 'finalValue',
  '--',
  'probe.js',
  '--no-inspect-brk',
], { cwd }, {
  stdout: assertSuccessfulProbe,
  trim: true,
});
