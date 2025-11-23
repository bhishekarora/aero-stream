# Aero Stream Event Hub

## Overview

Aero Stream is a lightweight HTTP + WebSocket event fan-out designed for airport operations. Think of it as a simpler alternative to Kafka or Azure Event Hub for ingesting feeds from AMS, Xovis, and other Aero sensor systems. Producers post events to topic-specific HTTP endpoints, and every consumer subscribed to that topic instantly receives those events over WebSockets.

```
		   +------------------+
Producer   |    Express        |
 POST /publish/:topic          |
		   +---------+---------+
					 |
			  Message routed by topic
					 |
		   +---------v---------+       Broadcast via WS
		   | WebSocket Hub     |=================================
		   | ws://.../stream/:topic
		   +---------+---------+       Real-time consumers
					 |
	   +-------------+-------------+
	   |             |             |
	 +-v--+        +-v--+        +-v--+
	 |C1  |        |C2  |        |C3  |
	 |WS  |        |WS  |        |WS  |
	 +----+        +----+        +----+
```

## Core Components

- Topic-specific JSON schemas under `schemas/` validate inbound payloads before broadcasting. `ams` requires `flightId`, `event`, and `remarks`; `xovis` requires `location`, `queueName`, `waitingTime`, and optional `remarks`.

## Local Dev Quickstart

1. Install Node.js 18+ (includes `npm`).
2. `npm install` to pull dependencies.
3. `npm run dev` starts Express with WebSocket support.
4. Publish an AMS event: `curl -X POST http://localhost:3000/publish/ams -H "Content-Type: application/json" -d '{"flightId":"AAL123","event":"ARRIVED","remarks":"ONTIME"}'`.
5. Publish a Xovis event: `curl -X POST http://localhost:3000/publish/xovis -H "Content-Type: application/json" -d '{"location":"T1","queueName":"SEC1","waitingTime":"12","remarks":"BUSY"}'`.
6. Connect a WebSocket client (e.g., browser console, `wscat`) to `ws://localhost:3000/stream/ams` or `ws://localhost:3000/stream/xovis` and watch topic-scoped events arrive.
7. Visit `http://localhost:3000/admin` to browse the latest entries captured in `inbound.log`.

## Load Testing

- Run `node --test tests/loadtest.test.js` to pound `/publish/loadtest` with 10→100 requests per second.
- Each burst logs a `loadtest` summary entry in `inbound.log` (`transactionsPerSecond`, `success`, `failed`, `avgResponseTimeMs`) and prints a `[LOADTEST]` line to the console so you can spot the break point.

## Next Steps

- Wrap published events in a consistent schema (timestamp, source, payload).
- Add wildcard subscriptions so some clients can mirror multiple topics when needed.
- Add minimal auth (API key header for producers, token gate for consumers).
- Implement optional retry/backoff logic for transient publish failures.
- Persist inbound logs to long-term storage once durability requirements grow.

## Contributing

- Use feature branches for enhancements or bug fixes.
- Add lightweight tests (integration or smoke) whenever behavior changes.
- Submit pull requests with clear context, especially around event formats.

## License

GPL