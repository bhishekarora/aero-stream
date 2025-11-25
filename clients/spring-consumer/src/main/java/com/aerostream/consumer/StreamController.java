package com.aerostream.consumer;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
public class StreamController {

    private final AmsStreamService streamService;

    public StreamController(AmsStreamService streamService) {
        this.streamService = streamService;
    }

    @GetMapping(value = "/incoming", produces = MediaType.TEXT_HTML_VALUE)
    public String incomingPage() {
        return """
                <!doctype html>
                <html lang=\"en\">
                  <head>
                    <meta charset=\"utf-8\" />
                    <title>AMS Stream Consumer</title>
                    <style>
                      body { font-family: Arial, sans-serif; background: #111827; color: #e5e7eb; margin: 0; }
                      header { padding: 1rem 1.5rem; background: #16a34a; color: #fff; }
                      main { padding: 1.5rem; }
                      .msg { margin-bottom: 1rem; padding: 1rem; border-radius: 8px; background: rgba(22, 163, 74, 0.15); }
                      .timestamp { font-size: 0.85rem; color: #bbf7d0; }
                      pre { margin: 0; font-family: 'Fira Code', monospace; }
                    </style>
                  </head>
                  <body>
                    <header>
                      <h1>SPRING BACKEND AMS WebSocket Feed</h1>
                      <p>Connected to %s</p>
                    </header>
                    <main>
                      <div id=\"messages\"></div>
                    </main>
                    <script>
                      async function refresh() {
                        const res = await fetch('/events');
                        const data = await res.json();
                        const container = document.getElementById('messages');
                        container.innerHTML = data.messages.map((msg) => `
                          <div class="msg">
                            <div class="timestamp">${msg.receivedAt}</div>
                            <pre>${JSON.stringify(msg.payload, null, 2)}</pre>
                          </div>
                        `).join('');
                      }
                      refresh();
                      setInterval(refresh, 2000);
                    </script>
                  </body>
                </html>
                """.formatted(streamService.getSourceUrl());
    }

    @GetMapping("/events")
    public Map<String, List<Map<String, Object>>> events() {
        List<Map<String, Object>> payloads = streamService.getMessages().stream()
                .map(message -> Map.of(
                        "receivedAt", message.receivedAt().toString(),
                        "payload", jsonToObject(message.payload())
                ))
                .collect(Collectors.toList());

        return Map.of("messages", payloads);
    }

    private Object jsonToObject(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (node.isObject() || node.isArray()) {
            return node;
        }
        if (node.isNumber()) {
            return node.numberValue();
        }
        if (node.isBoolean()) {
            return node.booleanValue();
        }
        return node.asText();
    }
}
