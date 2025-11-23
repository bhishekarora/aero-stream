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

test('Xovis payloads broadcast to subscribers and persist', async (t) => {
  const { server } = createAeroStreamServer();

  await new Promise((resolve) => {
    server.listen(0, resolve);
  });

  const { port } = server.address();
  t.after(() => closeServer(server));

  const ws = new WebSocket(`ws://127.0.0.1:${port}/stream/xovis`);

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

  const payload = {
    location: 'T1',
    queueName: 'SEC1',
    waitingTime: '12',
    remarks: 'BUSY',
  };

  await supertest(server)
    .post('/publish/xovis')
    .send(payload)
    .expect(202);

  const message = await messagePromise;
  assert.equal(message.topic, 'xovis');
  assert.deepEqual(message.payload, payload);

  await closeSocket(ws);

  const rawLog = await fs.readFile(LOG_FILE, 'utf8');
  const lines = rawLog.trim().split('\n');
  const last = JSON.parse(lines.at(-1));

  assert.equal(last.topic, 'xovis');
  assert.deepEqual(last.payload, payload);

  console.log('[XOVIS] Broadcast + persistence test passed');
});

test('Xovis payloads enforce schema rules', async (t) => {
  const { server } = createAeroStreamServer();

  await new Promise((resolve) => {
    server.listen(0, resolve);
  });

  t.after(() => closeServer(server));

  await supertest(server)
    .post('/publish/xovis')
    .send({ queueName: 'SEC1', waitingTime: '10', remarks: 'BUSY' })
    .expect(422)
    .expect((res) => {
      assert.match(res.body.error, /location/);
    });

  await supertest(server)
    .post('/publish/xovis')
    .send({ location: 'T1', queueName: 'SEC1', waitingTime: 'TEN', remarks: 'BUSY' })
    .expect(422)
    .expect((res) => {
      assert.match(res.body.error, /waitingTime/);
    });

  console.log('[XOVIS] Schema validation test passed');
});
