package com.aerostream.consumer;

import com.fasterxml.jackson.databind.JsonNode;

import java.time.Instant;

public record StreamMessage(Instant receivedAt, JsonNode payload) {
}
