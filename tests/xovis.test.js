'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const supertest = require('supertest');
const WebSocket = require('ws');

const BASE_URL = process.env.AERO_STREAM_BASE_URL || 'http://localhost:3000';
const LOG_FILE = path.resolve(process.cwd(), 'inbound.log');
const request = supertest(BASE_URL);

async function closeSocket(ws) {
  if (ws.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise((resolve) => {
    ws.once('close', resolve);
    ws.close();
  });
}

async function ensureServerAvailable() {
  try {
    await request.get('/healthz').timeout({ deadline: 2000 });
  } catch (error) {
    throw new Error(`Aero Stream server is not reachable at ${BASE_URL}. Start it before running tests.`);
  }
}

function buildWebSocketUrl(topic) {
  const url = new URL(BASE_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `/stream/${topic}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function findLogEntry(predicate) {
  const rawLog = await fs.readFile(LOG_FILE, 'utf8');
  const lines = rawLog
    .trim()
    .split('\n')
    .filter(Boolean)
    .reverse();

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (predicate(entry)) {
        return entry;
      }
    } catch (error) {
      // skip malformed lines
    }
  }

  return null;
}

test('Xovis payloads broadcast to subscribers and persist', async (t) => {
  await ensureServerAvailable();

  const ws = new WebSocket(buildWebSocketUrl('xovis'));

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
    location: `T${Date.now() % 1000}`,
    queueName: 'SEC1',
    waitingTime: '12',
    remarks: 'BUSY',
  };

  await request
    .post('/publish/xovis')
    .send(payload)
    .expect(202);

  const message = await messagePromise;
  assert.equal(message.topic, 'xovis');
  assert.deepEqual(message.payload, payload);

  await closeSocket(ws);

  const entry = await findLogEntry((logEntry) => {
    return (
      logEntry.topic === 'xovis' &&
      logEntry.payload &&
      logEntry.payload.location === payload.location &&
      logEntry.payload.queueName === payload.queueName
    );
  });

  assert.ok(entry, 'Expected Xovis payload to be recorded in inbound.log');
  assert.deepEqual(entry.payload, payload);

  console.log('[XOVIS] Broadcast + persistence test passed');
});

test('Xovis payloads enforce schema rules', async (t) => {
  await ensureServerAvailable();

  await request
    .post('/publish/xovis')
    .send({ queueName: 'SEC1', waitingTime: '10', remarks: 'BUSY' })
    .expect(422)
    .expect((res) => {
      assert.match(res.body.error, /location/);
    });

  await request
    .post('/publish/xovis')
    .send({ location: 'T1', queueName: 'SEC1', waitingTime: 'TEN', remarks: 'BUSY' })
    .expect(422)
    .expect((res) => {
      assert.match(res.body.error, /waitingTime/);
    });

  console.log('[XOVIS] Schema validation test passed');
});
