'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const supertest = require('supertest');
const WebSocket = require('ws');

const { createAeroStreamServer } = require('../src/server');

const LOG_FILE = path.resolve(process.cwd(), 'inbound.log');

async function removeLogIfExists() {
  await fs.rm(LOG_FILE, { force: true });
}

test('publishing to a topic logs and broadcasts to subscribers', async (t) => {
  await removeLogIfExists();

  const { server } = createAeroStreamServer();

  await new Promise((resolve) => {
    server.listen(0, resolve);
  });

  const { port } = server.address();

  t.after(() => new Promise((resolve) => server.close(resolve)));

  const ws = new WebSocket(`ws://127.0.0.1:${port}/stream/ams`);

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  t.after(() => new Promise((resolve) => {
    ws.once('close', resolve);
    ws.close();
  }));

  const messagePromise = new Promise((resolve, reject) => {
    ws.once('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
    ws.once('error', reject);
  });

  await supertest(server)
    .post('/publish/ams')
    .send({ flightId: 'AAL123', event: 'ARRIVED', gate: 'A21' })
    .expect(202);

  const message = await messagePromise;
  assert.equal(message.topic, 'ams');
  assert.equal(message.payload.flightId, 'AAL123');
  assert.equal(message.payload.event, 'ARRIVED');
  assert.equal(message.payload.gate, 'A21');

  await new Promise((resolve) => setTimeout(resolve, 25));

  const rawLog = await fs.readFile(LOG_FILE, 'utf8');
  const lines = rawLog.trim().split('\n');
  const last = JSON.parse(lines.at(-1));

  assert.equal(last.topic, 'ams');
  assert.equal(last.payload.flightId, 'AAL123');
  assert.equal(last.payload.event, 'ARRIVED');
  assert.equal(last.payload.gate, 'A21');
});

test('invalid payloads fail schema validation', async (t) => {
  await removeLogIfExists();

  const { server } = createAeroStreamServer();

  await new Promise((resolve) => {
    server.listen(0, resolve);
  });

  t.after(() => new Promise((resolve) => server.close(resolve)));

  await supertest(server)
    .post('/publish/ams')
    .send({ event: 'LANDING', gate: 'A21' }) // missing flightId
    .expect(422)
    .expect((res) => {
      assert.match(res.body.error, /flightId/);
    });
});
