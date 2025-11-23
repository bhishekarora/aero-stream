const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const LOG_FILE = path.resolve(process.cwd(), 'inbound.log');
const SCHEMA_DIR = path.resolve(process.cwd(), 'schemas');
const schemaCache = new Map();

const TYPE_PATTERNS = {
  alpha: /^[A-Za-z]+$/,
  alphanumeric: /^[A-Za-z0-9]+$/,
};

function ensureLogFile() {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  } catch (error) {
    // no-op when directory already exists
  }

  fs.writeFileSync(LOG_FILE, '', 'utf8');
}

async function loadTopicSchema(topic) {
  if (schemaCache.has(topic)) {
    return schemaCache.get(topic);
  }

  const schemaPath = path.join(SCHEMA_DIR, `${topic}.schema.json`);

  try {
    const contents = await fsp.readFile(schemaPath, 'utf8');
    const parsed = JSON.parse(contents);
    schemaCache.set(topic, parsed);
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      schemaCache.set(topic, null);
      return null;
    }

    throw error;
  }
}

function validatePayloadAgainstSchema(topic, payload, schema) {
  if (!schema) {
    return null;
  }

  const { required = [], fields = {} } = schema;

  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) {
      return `Missing required field \"${field}\" for topic \"${topic}\"`;
    }
  }

  for (const [field, definition] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) {
      continue;
    }

    const value = payload[field];

    if (typeof value !== 'string') {
      return `Field \"${field}\" must be a string`;
    }

    const type = typeof definition === 'string' ? definition : definition.type;
    if (type && TYPE_PATTERNS[type] && !TYPE_PATTERNS[type].test(value)) {
      return `Field \"${field}\" must match ${type}`;
    }
  }

  return null;
}

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function appendLog(entry) {
  const serialized = `${JSON.stringify(entry)}\n`;
  await fsp.appendFile(LOG_FILE, serialized, 'utf8');
} 

async function readLogEntries() {
  try {
    const contents = await fsp.readFile(LOG_FILE, 'utf8');
    return contents
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          return { error: 'Malformed log line', raw: line };
        }
      });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function createAdminPage(entries) {
  const rows = entries
    .slice(-100) // avoid dumping unbounded logs into the page
    .reverse() // show newest first
    .map((entry) => {
      if (entry.error) {
        return `<tr><td colspan="3" class="error">${escapeHtml(entry.raw || 'Unknown log error')}</td></tr>`;
      }

      const payload = escapeHtml(JSON.stringify(entry.payload, null, 2));
      return `
        <tr>
          <td>${escapeHtml(entry.timestamp || '')}</td>
          <td>${escapeHtml(entry.topic || '')}</td>
          <td><pre>${payload}</pre></td>
        </tr>
      `;
    })
    .join('');

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Aero Stream Admin</title>
        <style>
          :root {
            color-scheme: light; /* keep colors vivid */
          }
          body { font-family: 'Segoe UI', sans-serif; padding: 1.5rem; background: #f8fafc; color: #0f172a; }
          h1 { margin-bottom: 1rem; color: #1d4ed8; }
          table { width: 100%; border-collapse: collapse; background: #ffffff; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.1); border-radius: 12px; overflow: hidden; }
          th { background: #dbeafe; color: #1e3a8a; text-align: left; }
          th, td { padding: 0.75rem 1rem; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
          tr:last-child td { border-bottom: none; }
          pre { margin: 0; font-family: 'Fira Code', monospace; white-space: pre-wrap; word-break: break-word; background: #eff6ff; padding: 0.5rem; border-radius: 8px; }
          .error { color: #dc2626; font-weight: 600; }
          .meta { color: #475569; }
        </style>
        </style>
      </head>
      <body>
        <h1>Aero Stream Inbound Log</h1>
        <p class="meta">Showing up to the 100 most recent events recorded in <code>inbound.log</code>.</p>
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Topic</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="3">No events recorded yet.</td></tr>'}
          </tbody>
        </table>
      </body>
    </html>
  `;
}

function createApp(broadcast) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.post('/publish/:topic', async (req, res) => {
    const { topic } = req.params;
    const payload = req.body;

    if (!topic) {
      return res.status(400).json({ error: 'Topic is required' });
    }

    if (payload === undefined || payload === null || typeof payload !== 'object') {
      return res.status(400).json({ error: 'JSON body is required' });
    }

    let schema;
    try {
      schema = await loadTopicSchema(topic);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to load topic schema' });
    }

    const validationIssue = validatePayloadAgainstSchema(topic, payload, schema);
    if (validationIssue) {
      return res.status(422).json({ error: validationIssue });
    }

    const eventEnvelope = {
      timestamp: new Date().toISOString(),
      topic,
      payload,
    };

    try {
      await appendLog(eventEnvelope);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to write inbound log' });
    }

    broadcast(topic, eventEnvelope);
    return res.status(202).json({ status: 'accepted' });
  });

  app.get('/admin', async (req, res, next) => {
    try {
      const entries = await readLogEntries();
      const html = createAdminPage(entries);
      res.type('html').send(html);
    } catch (error) {
      next(error);
    }
  });

  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}

function createAeroStreamServer() {
  ensureLogFile();

  const topicClients = new Map();

  const broadcast = (topic, message) => {
    const clients = topicClients.get(topic);
    if (!clients || clients.size === 0) {
      return;
    }

    const serialized = JSON.stringify(message);

    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  };

  const app = createApp(broadcast);
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const { url = '' } = req;
    let topic = null;

    try {
      const { pathname } = new URL(url, `http://${req.headers.host}`);
      const parts = pathname.split('/').filter(Boolean);

      if (parts.length === 2 && parts[0] === 'stream') {
        topic = parts[1];
      }
    } catch (error) {
      // ignore malformed URLs
    }

    if (!topic) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, topic);
    });
  });

  wss.on('connection', (ws, req, topic) => {
    if (!topicClients.has(topic)) {
      topicClients.set(topic, new Set());
    }

    const clients = topicClients.get(topic);
    clients.add(ws);

    ws.on('close', () => {
      clients.delete(ws);
      if (clients.size === 0) {
        topicClients.delete(topic);
      }
    });

    ws.on('error', () => {
      clients.delete(ws);
      if (clients.size === 0) {
        topicClients.delete(topic);
      }
    });
  });

  return { app, server, wss };
}

if (require.main === module) {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const { server } = createAeroStreamServer();

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Aero Stream listening on http://localhost:${port}`);
    // eslint-disable-next-line no-console
    console.log('POST events to /publish/:topic, connect consumers via ws://<host>/stream/:topic');
  });
}

module.exports = {
  createAeroStreamServer,
  createApp,
};
