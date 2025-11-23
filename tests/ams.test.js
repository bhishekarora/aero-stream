'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const supertest = require('supertest');
const WebSocket = require('ws');

const { createAeroStreamServer } = require('../src/server');

const LOG_FILE = path.resolve(process.cwd(), 'inbound.log');

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function closeSocket(ws) {
  if (ws.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise((resolve) => {
    ws.once('close', resolve);
    ws.close();
  });
}

test('AMS payloads broadcast to subscribers and persist', async (t) => {
  const { server } = createAeroStreamServer();

  await new Promise((resolve) => {
    server.listen(0, resolve);
  });

  const { port } = server.address();
  t.after(() => closeServer(server));

  const ws = new WebSocket(`ws://127.0.0.1:${port}/stream/ams`);

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  t.after(() => closeSocket(ws));

  const messagePromise = new Promise((resolve, reject) => {
    ws.once('message', (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (error) {
        reject(error);
      }
    });
    ws.once('error', reject);
  });

  const payload = { flightId: 'AAL123', event: 'ARRIVED', remarks: 'ONTIME' };

  await supertest(server)
    .post('/publish/ams')
    .send(payload)
    .expect(202);

  const message = await messagePromise;
  assert.equal(message.topic, 'ams');
  assert.deepEqual(message.payload, payload);

  await closeSocket(ws);

  const rawLog = await fs.readFile(LOG_FILE, 'utf8');
  const lines = rawLog.trim().split('\n');
  const last = JSON.parse(lines.at(-1));

  assert.equal(last.topic, 'ams');
  assert.deepEqual(last.payload, payload);

  console.log('[AMS] Broadcast + persistence test passed');
});

test('AMS payloads enforce schema rules', async (t) => {
  const { server } = createAeroStreamServer();

  await new Promise((resolve) => {
    server.listen(0, resolve);
  });

  t.after(() => closeServer(server));

  await supertest(server)
    .post('/publish/ams')
    .send({ event: 'LANDING', remarks: 'ONTIME' })
    .expect(422)
    .expect((res) => {
      assert.match(res.body.error, /flightId/);
    });

  await supertest(server)
    .post('/publish/ams')
    .send({ flightId: 'AAL123', event: 'LANDING7', remarks: 'ONTIME' })
    .expect(422)
    .expect((res) => {
      assert.match(res.body.error, /event/);
    });

  await supertest(server)
    .post('/publish/ams')
    .send({ flightId: 'AAL123', event: 'LANDING', remarks: 'DELAYED#1' })
    .expect(422)
    .expect((res) => {
      assert.match(res.body.error, /remarks/);
    });

  console.log('[AMS] Schema validation test passed');
});
