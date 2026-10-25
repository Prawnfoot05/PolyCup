import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectWorker } from './postgres.mjs';
import { errorCode } from './processor.ts';

test('worker configuration fails closed before opening a connection', async () => {
  await assert.rejects(connectWorker({}), /disabled/);
  await assert.rejects(connectWorker({ POLYCUP_RESULT_WORKER_ENABLED: '1' }), /not configured/);
  const options = { POLYCUP_RESULT_WORKER_ENABLED: '1', POLYCUP_RESULT_LOCAL_TEST: '1' };
  await assert.rejects(connectWorker({ ...options, POLYCUP_RESULT_DATABASE_URL: 'postgres://secret@example.invalid/db' }), /loopback/);
  await assert.rejects(connectWorker({ ...options, POLYCUP_RESULT_DATABASE_URL: 'postgres://local@localhost/db?sslmode=disable' }), /SSL query/);
  await assert.rejects(connectWorker({ ...options, POLYCUP_RESULT_DATABASE_URL: 'https://localhost/db' }), /PostgreSQL URL/);
});

test('error summaries retain only SQLSTATE, never error messages or arbitrary codes', () => {
  assert.equal(errorCode({ code: '40001', message: 'sensitive evidence' }), '40001');
  assert.equal(errorCode({ code: 'postgres://credential@host/db' }), 'WORKER_ERROR');
  assert.equal(errorCode(new Error('sensitive evidence')), 'WORKER_ERROR');
});
