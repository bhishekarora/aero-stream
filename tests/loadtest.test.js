'use strict';

const test = require('node:test');
const supertest = require('supertest');

const BASE_URL = process.env.AERO_STREAM_BASE_URL || 'http://localhost:3000';
const request = supertest(BASE_URL);

const LOAD_LEVELS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

function hrtimeToMs(start, end) {
  return Number(end - start) / 1_000_000;
}

async function ensureServerAvailable() {
  try {
    await request.get('/healthz').timeout({ deadline: 2000 });
  } catch (error) {
    throw new Error(`Aero Stream server is not reachable at ${BASE_URL}. Start it before running tests.`);
  }
}

async function runBurst(rate) {
  let success = 0;
  let failed = 0;
  const durations = [];

  const base = Date.now();

  const tasks = Array.from({ length: rate }, (_, idx) => {
    const messageId = `L${rate}${idx}${base}`;
    const payload = { mode: 'PROBE', messageId };

    return (async () => {
      const start = process.hrtime.bigint();

      try {
        const res = await request
          .post('/publish/loadtest')
          .send(payload)
          .timeout({ deadline: 1500 });

        if (res.status >= 200 && res.status < 300) {
          success += 1;
        } else {
          failed += 1;
        }
      } catch (error) {
        failed += 1;
      } finally {
        const end = process.hrtime.bigint();
        durations.push(hrtimeToMs(start, end));
      }
    })();
  });

  await Promise.all(tasks);

  const avgMs = durations.length
    ? Math.round(durations.reduce((acc, value) => acc + value, 0) / durations.length)
    : 0;

  return { rate, success, failed, avgMs };
}

async function recordSummary(summary) {
  const { rate, success, failed, avgMs } = summary;

  await request
    .post('/publish/loadtest')
    .send({
      mode: 'SUMMARY',
      transactionsPerSecond: String(rate),
      success: String(success),
      failed: String(failed),
      avgResponseTimeMs: String(avgMs),
    })
    .expect(202);

  console.log(
    `[LOADTEST] ${rate} rps -> success=${success} failed=${failed} avgResponseTimeMs=${avgMs}`,
  );
}

test('Load test /publish/loadtest across burst levels', async (t) => {
  await ensureServerAvailable();

  for (const rate of LOAD_LEVELS) {
    const summary = await runBurst(rate);
    await recordSummary(summary);
  }
});
