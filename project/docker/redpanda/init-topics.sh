#!/usr/bin/env sh
set -e

BROKER="${KAFKA_BROKERS:-broker:9092}"
SNAPSHOTS="${TOPIC_INGEST_SNAPSHOTS:-ingest.snapshots.v1}"
CLIP_TEXT="${TOPIC_INGEST_CLIP_TEXT:-ingest.clip-text.v1}"
INVALID="${TOPIC_INGEST_INVALID:-ingest.invalid.v1}"
CLIP_VIEWS="${TOPIC_AGGREGATOR_CLIP_VIEWS:-aggregator.clip-views.v1}"
DLQ="${TOPIC_DLQ_COMMANDS:-dlq.commands.v1}"

echo "Waiting for Redpanda broker ($BROKER) to become ready..."
until rpk cluster info --brokers "$BROKER" >/dev/null 2>&1; do
  sleep 1
done

echo "Redpanda broker is ready! Creating topics..."

rpk topic create "$SNAPSHOTS" -p 6 --brokers "$BROKER" || true
rpk topic create "$CLIP_TEXT" -p 6 --brokers "$BROKER" || true
rpk topic create "$INVALID" -p 6 --brokers "$BROKER" || true
rpk topic create "$CLIP_VIEWS" -p 6 --brokers "$BROKER" || true
rpk topic create "$DLQ" -p 1 --brokers "$BROKER" || true

echo "All Redpanda topics successfully initialized!"
