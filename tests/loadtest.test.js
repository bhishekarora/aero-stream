'use strict';

const test = require('node:test');
const supertest = require('supertest');

const { createAeroStreamServer } = require('../src/server');

const LOAD_LEVELS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

function hrtimeToMs(start, end) {
  return Number(end - start) / 1_000_000;
}

async function runBurst(request, rate) {
  let success = 0;
  let failed = 0;
  const durations = [];

  const base = Date.now();

  const tasks = Array.from({ length: rate }, (_, idx) => {
    const messageId = `L${rate}${idx}${base}`;
    const payload = { messageId };

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

async function recordSummary(request, summary) {
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
  const { server } = createAeroStreamServer();

  await new Promise((resolve) => {
    server.listen(0, resolve);
  });

  t.after(() => new Promise((resolve) => server.close(resolve)));

  const request = supertest(server);

  for (const rate of LOAD_LEVELS) {
    const summary = await runBurst(request, rate);
    await recordSummary(request, summary);
  }
});
