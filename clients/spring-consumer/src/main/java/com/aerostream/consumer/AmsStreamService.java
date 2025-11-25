package com.aerostream.consumer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;

import java.net.URI;
import java.time.Instant;
import java.util.Deque;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

@Component
public class AmsStreamService {

    private static final Logger log = LoggerFactory.getLogger(AmsStreamService.class);
    private static final int MAX_MESSAGES = 200;

    private final ObjectMapper objectMapper;
    private final String sourceUrl;
    private final Deque<StreamMessage> messages = new ConcurrentLinkedDeque<>();
    private final ScheduledExecutorService reconnectExecutor = Executors.newSingleThreadScheduledExecutor();

    private volatile WebSocketClient client;

    public AmsStreamService(ObjectMapper objectMapper,
                            @Value("${aero.stream.ams-url:ws://localhost:3000/stream/ams}") String sourceUrl) {
        this.objectMapper = objectMapper;
        this.sourceUrl = sourceUrl;
    }

    @PostConstruct
    public void start() {
        connect();
    }

    private void connect() {
        try {
            URI uri = new URI(sourceUrl);
            client = new InternalWebSocketClient(uri);
            client.connect();
            log.info("Connecting to AMS stream at {}", sourceUrl);
        } catch (Exception e) {
            log.error("Failed to initiate AMS WebSocket connection", e);
            scheduleReconnect();
        }
    }

    private void scheduleReconnect() {
        reconnectExecutor.schedule(this::connect, 2, TimeUnit.SECONDS);
    }

    public Deque<StreamMessage> getMessages() {
        return messages;
    }

    public String getSourceUrl() {
        return sourceUrl;
    }

    @PreDestroy
    public void shutdown() {
        if (client != null) {
            client.close();
        }
        reconnectExecutor.shutdownNow();
    }

    private class InternalWebSocketClient extends WebSocketClient {

        private InternalWebSocketClient(URI serverUri) {
            super(serverUri);
        }

        @Override
        public void onOpen(ServerHandshake handshakedata) {
            log.info("[SPRING CONSUMER] Connected to {}", sourceUrl);
        }

        @Override
        public void onMessage(String message) {
            log.debug("[SPRING CONSUMER] raw message: {}", message);
            try {
                JsonNode payload = objectMapper.readTree(message);
                messages.addLast(new StreamMessage(Instant.now(), payload));
                while (messages.size() > MAX_MESSAGES) {
                    messages.pollFirst();
                }
                log.info("[SPRING CONSUMER] message received {}", payload);
            } catch (Exception e) {
                log.warn("[SPRING CONSUMER] Failed to parse message", e);
            }
        }

        @Override
        public void onClose(int code, String reason, boolean remote) {
            log.warn("[SPRING CONSUMER] Connection closed (code={}, reason={}).", code, reason);
            scheduleReconnect();
        }

        @Override
        public void onError(Exception ex) {
            log.error("[SPRING CONSUMER] Connection error", ex);
            close();
        }
    }
}
