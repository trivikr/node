// Flags: --expose-gc
'use strict';

const common = require('../common');
const { skipIfSQLiteMissing } = common;
skipIfSQLiteMissing();
const { gcUntil } = require('../common/gc');

const assert = require('node:assert');
const dc = require('node:diagnostics_channel');
const { DatabaseSync } = require('node:sqlite');
const { suite, it } = require('node:test');

suite('sqlite.db.query diagnostics channel', () => {
  it('subscriber receives SQL string for exec() statements', (t) => {
    const calls = [];
    using db = new DatabaseSync(':memory:');

    const handler = (msg) => calls.push(msg);
    dc.subscribe('sqlite.db.query', handler);
    t.after(() => dc.unsubscribe('sqlite.db.query', handler));

    db.exec('CREATE TABLE t (x INTEGER)');
    db.exec('INSERT INTO t VALUES (1)');

    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].sql, 'CREATE TABLE t (x INTEGER)');
    assert.strictEqual(calls[1].sql, 'INSERT INTO t VALUES (1)');
  });

  it('subscriber receives SQL string for prepared INSERT statements', (t) => {
    let calls = [];
    using db = new DatabaseSync(':memory:');

    const handler = (msg) => calls.push(msg);
    dc.subscribe('sqlite.db.query', handler);
    t.after(() => dc.unsubscribe('sqlite.db.query', handler));

    db.exec('CREATE TABLE t (x INTEGER)');
    calls = []; // reset after setup

    using stmt = db.prepare('INSERT INTO t VALUES (?)');
    stmt.run(42);

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].sql, 'INSERT INTO t VALUES (42.0)');
  });

  it('subscriber receives SQL string for prepared SELECT statements', (t) => {
    let calls = [];
    using db = new DatabaseSync(':memory:');

    const handler = (msg) => calls.push(msg);
    dc.subscribe('sqlite.db.query', handler);
    t.after(() => dc.unsubscribe('sqlite.db.query', handler));

    db.exec('CREATE TABLE t (x INTEGER)');
    db.exec('INSERT INTO t VALUES (1)');
    calls = []; // reset after setup

    using stmt = db.prepare('SELECT x FROM t WHERE x = ?');
    stmt.get(1);

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].sql, 'SELECT x FROM t WHERE x = 1.0');
  });

  it('subscriber receives SQL string for prepared UPDATE statements', (t) => {
    let calls = [];
    using db = new DatabaseSync(':memory:');

    const handler = (msg) => calls.push(msg);
    dc.subscribe('sqlite.db.query', handler);
    t.after(() => dc.unsubscribe('sqlite.db.query', handler));

    db.exec('CREATE TABLE t (x INTEGER)');
    db.exec('INSERT INTO t VALUES (1)');
    calls = []; // reset after setup

    using stmt = db.prepare('UPDATE t SET x = ? WHERE x = ?');
    stmt.run(2, 1);

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].sql, 'UPDATE t SET x = 2.0 WHERE x = 1.0');
  });

  it('subscriber receives SQL string for prepared DELETE statements', (t) => {
    let calls = [];
    using db = new DatabaseSync(':memory:');

    const handler = (msg) => calls.push(msg);
    dc.subscribe('sqlite.db.query', handler);
    t.after(() => dc.unsubscribe('sqlite.db.query', handler));

    db.exec('CREATE TABLE t (x INTEGER)');
    db.exec('INSERT INTO t VALUES (1)');
    calls = []; // reset after setup

    using stmt = db.prepare('DELETE FROM t WHERE x = ?');
    stmt.run(1);

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].sql, 'DELETE FROM t WHERE x = 1.0');
  });

  it('no calls received after unsubscribe', (t) => {
    const calls = [];
    using db = new DatabaseSync(':memory:');

    const handler = (msg) => calls.push(msg);
    dc.subscribe('sqlite.db.query', handler);

    db.exec('CREATE TABLE t (x INTEGER)');
    assert.strictEqual(calls.length, 1);

    dc.unsubscribe('sqlite.db.query', handler);
    db.exec('INSERT INTO t VALUES (1)');
    assert.strictEqual(calls.length, 1); // No new calls after unsubscribe
  });

  it('falls back to source SQL when expansion fails', (t) => {
    let calls = [];
    using db = new DatabaseSync(':memory:', { limits: { length: 1000 } });

    const handler = (msg) => calls.push(msg);
    dc.subscribe('sqlite.db.query', handler);
    t.after(() => dc.unsubscribe('sqlite.db.query', handler));

    db.exec('CREATE TABLE t (x TEXT)');
    calls = []; // reset after setup

    using stmt = db.prepare('INSERT INTO t VALUES (?)');

    const longValue = 'a'.repeat(977);
    stmt.run(longValue);

    assert.strictEqual(calls.length, 1);
    // Falls back to source SQL with unexpanded '?' placeholder
    assert.strictEqual(calls[0].sql, 'INSERT INTO t VALUES (?)');
  });

  it('database property identifies the correct database', (t) => {
    const calls = [];
    using db1 = new DatabaseSync(':memory:');
    using db2 = new DatabaseSync(':memory:');

    const handler = (msg) => calls.push(msg);
    dc.subscribe('sqlite.db.query', handler);
    t.after(() => dc.unsubscribe('sqlite.db.query', handler));

    db1.exec('CREATE TABLE t (x INTEGER)');
    db2.exec('CREATE TABLE t (x INTEGER)');

    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].database, db1);
    assert.strictEqual(calls[1].database, db2);
    assert.notStrictEqual(calls[0].database, calls[1].database);
  });

  it('duration is a number', (t) => {
    const calls = [];
    using db = new DatabaseSync(':memory:');

    const handler = (msg) => calls.push(msg);
    dc.subscribe('sqlite.db.query', handler);
    t.after(() => dc.unsubscribe('sqlite.db.query', handler));

    db.exec('CREATE TABLE t (x INTEGER)');

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(typeof calls[0].duration, 'number');
  });

  it('duration is non-negative', (t) => {
    const calls = [];
    using db = new DatabaseSync(':memory:');

    const handler = (msg) => calls.push(msg);
    dc.subscribe('sqlite.db.query', handler);
    t.after(() => dc.unsubscribe('sqlite.db.query', handler));

    db.exec('CREATE TABLE t (x INTEGER)');

    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].duration >= 0);
  });

  it('does not publish while an unfinished statement is finalized by GC',
     async (t) => {
       let dbRef;
       const handler = common.mustNotCall(
         'finalizing an unfinished statement must not publish');

       t.after(() => dc.unsubscribe('sqlite.db.query', handler));

       (() => {
         const db = new DatabaseSync(':memory:');
         db.exec('CREATE TABLE t (x INTEGER)');
         db.exec('INSERT INTO t VALUES (1), (2)');

         dc.subscribe('sqlite.db.query', handler);

         const stmt = db.prepare('SELECT x FROM t');
         const iterator = stmt.iterate();
         const result = iterator.next();
         assert.strictEqual(result.done, false);
         assert.strictEqual(result.value.x, 1);
         dbRef = new WeakRef(db);
       })();

       await gcUntil('SQLite database should be collected',
                     () => dbRef.deref() === undefined);
     });

  it('prevents resources from closing inside a subscriber', (t) => {
    let calls = 0;
    using db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (x INTEGER)');
    using stmt = db.prepare('INSERT INTO t VALUES (?)');

    const handler = common.mustCall(() => {
      calls++;
      assert.throws(() => db.close(), {
        code: 'ERR_INVALID_STATE',
        message: 'database cannot be closed while in a callback',
      });
      assert.throws(() => stmt.close(), {
        code: 'ERR_INVALID_STATE',
        message: 'statement cannot be closed while in a callback',
      });
      assert.throws(() => stmt[Symbol.dispose](), {
        code: 'ERR_INVALID_STATE',
        message: 'statement cannot be closed while in a callback',
      });
    });
    dc.subscribe('sqlite.db.query', handler);
    t.after(() => dc.unsubscribe('sqlite.db.query', handler));

    assert.deepStrictEqual(stmt.run(1), {
      changes: 1,
      lastInsertRowid: 1,
    });
    assert.strictEqual(calls, 1);
  });
});
