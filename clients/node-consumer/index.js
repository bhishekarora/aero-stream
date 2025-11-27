const express = require('express');
const WebSocket = require('ws');

const SOURCE_WS_URL = process.env.SOURCE_WS_URL || 'ws://localhost:3000/stream/ils';
const PORT = Number(process.env.PORT || 4100);
const MAX_MESSAGES = 200;

const app = express();
const messages = [];

function addMessage(payload) {
  messages.push({
    receivedAt: new Date().toISOString(),
    payload,
  });

  if (messages.length > MAX_MESSAGES) {
    messages.splice(0, messages.length - MAX_MESSAGES);
  }
}

function buildHtmlPage() {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Xovis Stream Consumer</title>
      <style>
        body { font-family: sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; }
        header { padding: 1rem 1.5rem; background: #2563eb; color: #fff; }
        main { padding: 1.5rem; }
        code { font-family: 'Fira Code', monospace; }
        .msg { margin-bottom: 1rem; padding: 1rem; border-radius: 8px; background: rgba(37, 99, 235, 0.15); }
        .timestamp { font-size: 0.85rem; color: #93c5fd; }
      </style>
    </head>
    <body>
      <header>
        <h1>Angular Consumer Xovis WebSocket Feed</h1>
        <p>Connected to ${SOURCE_WS_URL}</p>
      </header>
      <main>
        <div id="messages"></div>
      </main>
      <script>
        async function refresh() {
          const res = await fetch('/events');
          const data = await res.json();
          const container = document.getElementById('messages');
          container.innerHTML = data.messages.map((msg) => \`
            <div class="msg">
              <div class="timestamp">\${msg.receivedAt}</div>
              <pre>\${JSON.stringify(msg.payload, null, 2)}</pre>
            </div>
          \`).join('');
        }

        refresh();
        setInterval(refresh, 2000);
      </script>
    </body>
  </html>`;
}

app.get('/incoming', (_req, res) => {
  res.type('html').send(buildHtmlPage());
});

app.get('/events', (_req, res) => {
  res.json({ messages });
});

let ws;
let reconnectTimer = null;

function connect() {
  ws = new WebSocket(SOURCE_WS_URL);

  ws.on('open', () => {
    console.log(`[NODE CONSUMER] Connected to ${SOURCE_WS_URL}`);
  });

  ws.on('message', (data) => {
    try {
      const parsed = JSON.parse(data.toString());
      addMessage(parsed);
      console.log('[NODE CONSUMER] message received', parsed);
    } catch (error) {
      console.error('[NODE CONSUMER] failed to parse message', error);
    }
  });

  ws.on('close', () => {
    console.warn('[NODE CONSUMER] connection closed, retrying in 2s');
    scheduleReconnect();
  });

  ws.on('error', (error) => {
    console.error('[NODE CONSUMER] connection error', error.message);
    ws.close();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 2000);
}

process.on('SIGINT', () => {
  console.log('Shutting down Node consumer...');
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  process.exit(0);
});

connect();

app.listen(PORT, () => {
  console.log(`Node consumer listening on http://localhost:${PORT}/incoming`);
});
