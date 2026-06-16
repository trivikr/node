// Flags: --expose-internals
'use strict';

const common = require('../common');

common.skipIfInspectorDisabled();

const assert = require('assert');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const createRepl = require('internal/debugger/inspect_repl');

function createGate() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createAgent(domain, calls, gates) {
  const agent = new EventEmitter();
  const method = (name) => async () => {
    calls.push(`${domain}.${name}`);
    if (domain === 'Runtime' && name === 'runIfWaitingForDebugger') {
      const gate = gates.shift();
      if (gate) {
        await gate.promise;
      }
    }
  };

  agent.enable = method('enable');
  agent.setSamplingInterval = method('setSamplingInterval');
  agent.setAsyncCallStackDepth = method('setAsyncCallStackDepth');
  agent.setBlackboxPatterns = method('setBlackboxPatterns');
  agent.setPauseOnExceptions = method('setPauseOnExceptions');
  agent.runIfWaitingForDebugger = method('runIfWaitingForDebugger');
  agent.getScriptSource = async () => ({ scriptSource: "'use strict';\n" });
  return agent;
}

function evalCommand(repl, command) {
  return new Promise((resolve, reject) => {
    repl.eval(
      command,
      repl.context,
      'debugger-repl-test',
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      },
    );
  });
}

async function assertCommandWaitsForInit(repl, command, gate, calls) {
  let settled = false;
  const promise = evalCommand(repl, command).then(() => {
    settled = true;
  });

  await new Promise(setImmediate);
  assert.strictEqual(
    settled,
    false,
    `${command} resolved before post-connect initialization completed: ${calls}`,
  );

  gate.resolve();
  await promise;
  assert.strictEqual(settled, true);
}

(async () => {
  const calls = [];
  const runGate = createGate();
  const restartGate = createGate();
  const gates = [null, runGate, restartGate];
  const inspector = {
    client: new EventEmitter(),
    domainNames: ['Debugger', 'HeapProfiler', 'Profiler', 'Runtime'],
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    run: common.mustCall(async () => {
      calls.push('inspector.run');
    }, 2),
    suspendReplWhile(fn) {
      return fn();
    },
  };

  for (const domain of inspector.domainNames) {
    inspector[domain] = createAgent(domain, calls, gates);
  }

  const repl = await createRepl(inspector)();

  await assertCommandWaitsForInit(repl, 'run', runGate, calls);
  await assertCommandWaitsForInit(repl, 'restart', restartGate, calls);

  assert.deepStrictEqual(
    calls.filter((call) => (
      call === 'inspector.run' ||
      call === 'Runtime.runIfWaitingForDebugger'
    )),
    [
      'Runtime.runIfWaitingForDebugger',
      'inspector.run',
      'Runtime.runIfWaitingForDebugger',
      'inspector.run',
      'Runtime.runIfWaitingForDebugger',
    ],
  );

  repl.close();
})().then(common.mustCall());

(async () => {
  const calls = [];
  const pauseGate = createGate();
  const inspector = {
    options: { script: 'three-lines.js' },
    client: new EventEmitter(),
    domainNames: ['Debugger', 'HeapProfiler', 'Profiler', 'Runtime'],
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    run: common.mustNotCall(),
    print(value, addNewline = true) {
      this.stdout.write(addNewline ? `${value}\n` : value);
    },
    async suspendReplWhile(fn) {
      calls.push('suspendReplWhile');
      await fn();
      await pauseGate.promise;
    },
  };

  for (const domain of inspector.domainNames) {
    inspector[domain] = createAgent(domain, calls, [null]);
  }

  let settled = false;
  const replPromise = createRepl(inspector)().then((repl) => {
    settled = true;
    return repl;
  });

  await new Promise(setImmediate);
  assert.strictEqual(
    settled,
    false,
    'startRepl resolved before receiving the initial pause',
  );

  inspector.Debugger.emit('scriptParsed', {
    scriptId: '1',
    url: '/tmp/three-lines.js',
  });
  inspector.Debugger.emit('paused', {
    reason: 'Break on start',
    callFrames: [{
      functionName: '',
      location: { scriptId: '1', lineNumber: 0, columnNumber: 0 },
      scopeChain: [],
    }],
  });

  await new Promise(setImmediate);
  assert.strictEqual(
    settled,
    false,
    'startRepl resolved before the initial pause was handled',
  );

  pauseGate.resolve();
  const repl = await replPromise;
  assert.strictEqual(settled, true);
  assert.match(inspector.stdout.read().toString(), /Break on start in/);

  repl.close();
})().then(common.mustCall());
