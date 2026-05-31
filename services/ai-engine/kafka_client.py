"""
Project Aegis — AI Engine Kafka Client

Consumes aegis.logs.extracted events from Kafka, runs local ML inference,
and publishes aegis.ai.diagnosis.completed events back into the pipeline.

This module runs as a background thread alongside the FastAPI HTTP server,
ensuring the AI engine participates in the Kafka event stream without
requiring direct HTTP calls from the NestJS control plane.

Architecture:
  [Kafka: aegis.logs.extracted]
        ↓ (KafkaConsumer thread)
  [inference pipeline]
        ↓ (KafkaProducer)
  [Kafka: aegis.ai.diagnosis.completed]

Consumer group: aegis-ai-engine-group
Partitions: 3 (aligned with topic config)
Auto-commit: disabled — manual commit after successful publish ensures
             exactly-once processing semantics within the pipeline.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Callable

from kafka import KafkaConsumer, KafkaProducer
from kafka.errors import KafkaError, NoBrokersAvailable

if TYPE_CHECKING:
    # Avoid circular imports — inference pipeline is injected at runtime
    from embedding_pipeline import EmbeddingPipeline
    from classifier import IncidentClassifier

logger = logging.getLogger("aegis.kafka_client")

# ─────────────────────────────────────────────────────────────────────────────
# Topic constants — must match infrastructure/kafka/topics.json
# ─────────────────────────────────────────────────────────────────────────────
TOPIC_LOGS_EXTRACTED = "aegis.logs.extracted"
TOPIC_AI_DIAGNOSIS_COMPLETED = "aegis.ai.diagnosis.completed"
TOPIC_AUDIT_EVENTS = "aegis.audit.events"
CONSUMER_GROUP = "aegis-ai-engine-group"


def _build_consumer(brokers: list[str]) -> KafkaConsumer:
    return KafkaConsumer(
        TOPIC_LOGS_EXTRACTED,
        bootstrap_servers=brokers,
        group_id=CONSUMER_GROUP,
        auto_offset_reset="latest",
        enable_auto_commit=False,
        value_deserializer=lambda b: json.loads(b.decode("utf-8")),
        # Retry-safe: consumer will reconnect automatically
        reconnect_backoff_ms=500,
        reconnect_backoff_max_ms=10_000,
        session_timeout_ms=30_000,
        heartbeat_interval_ms=10_000,
        max_poll_records=5,
        fetch_max_bytes=10_485_760,  # 10 MB — matches broker max.message.bytes
    )


def _build_producer(brokers: list[str]) -> KafkaProducer:
    return KafkaProducer(
        bootstrap_servers=brokers,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        acks="all",
        retries=5,
        retry_backoff_ms=300,
        compression_type="lz4",
        linger_ms=5,
        batch_size=16_384,
    )


def _build_envelope(
    event_type: str,
    payload: dict,
    correlation_id: str,
) -> dict:
    """Build a typed Kafka event envelope matching the NestJS KafkaEventEnvelope contract."""
    return {
        "eventId": str(uuid.uuid4()),
        "eventType": event_type,
        "source": "ai-engine",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "correlationId": correlation_id,
        "serviceName": "aegis-ai-engine",
        "payload": payload,
    }


class AegisKafkaClient:
    """
    Kafka consumer/producer pair for the AI engine inference pipeline.

    Lifecycle:
      - start() launches the consumer loop in a daemon thread.
      - stop() signals the thread to terminate and blocks until it exits.
    """

    def __init__(
        self,
        run_inference: Callable[[str], dict],
        brokers: list[str] | None = None,
    ) -> None:
        """
        Args:
            run_inference: Callable that accepts raw log text and returns a
                           diagnosis dict (matching DiagnoseResponse schema).
            brokers: Kafka broker addresses. Defaults to KAFKA_BROKER env var.
        """
        self._run_inference = run_inference
        self._brokers = brokers or [
            b.strip()
            for b in os.getenv("KAFKA_BROKER", "aegis-kafka:9092").split(",")
            if b.strip()
        ]
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._consumer: KafkaConsumer | None = None
        self._producer: KafkaProducer | None = None

    # ─────────────────────────────────────────────────────────────────────────
    # Public API
    # ─────────────────────────────────────────────────────────────────────────

    def start(self) -> None:
        """Start the Kafka consumer loop in a background daemon thread."""
        if self._thread and self._thread.is_alive():
            logger.warning("Kafka client is already running.")
            return

        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._consume_loop,
            name="aegis-kafka-consumer",
            daemon=True,
        )
        self._thread.start()
        logger.info(
            "Kafka client started. Consuming %s from brokers: %s",
            TOPIC_LOGS_EXTRACTED,
            self._brokers,
        )

    def stop(self) -> None:
        """Signal the consumer loop to terminate and wait for clean shutdown."""
        self._stop_event.set()
        if self._consumer:
            # Wakeup the consumer poll() so it can check the stop event
            self._consumer.wakeup()
        if self._thread:
            self._thread.join(timeout=15)
            if self._thread.is_alive():
                logger.warning("Kafka consumer thread did not exit cleanly within 15s.")
        if self._producer:
            self._producer.flush(timeout=10)
            self._producer.close(timeout=10)
        logger.info("Kafka client stopped.")

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    # ─────────────────────────────────────────────────────────────────────────
    # Internal: consumer loop
    # ─────────────────────────────────────────────────────────────────────────

    def _consume_loop(self) -> None:
        """
        Main consumer loop. Runs until stop() is called.

        Error handling strategy:
          - NoBrokersAvailable: retry with exponential backoff, never crash.
          - KafkaError: log and continue — consumer will auto-reconnect.
          - Inference failure: publish a safe IGNORE diagnosis, commit offset.
          - Unhandled exception: log critical, exit thread (will be restarted).
        """
        import time

        backoff_seconds = 5
        max_backoff = 60

        while not self._stop_event.is_set():
            try:
                logger.info("Connecting Kafka consumer to %s...", self._brokers)
                self._consumer = _build_consumer(self._brokers)
                self._producer = _build_producer(self._brokers)
                backoff_seconds = 5  # Reset on successful connect

                logger.info(
                    "Kafka consumer connected. Polling %s...",
                    TOPIC_LOGS_EXTRACTED,
                )

                for message in self._consumer:
                    if self._stop_event.is_set():
                        break

                    try:
                        self._process_message(message)
                        # Manual commit after successful processing + publish
                        self._consumer.commit()
                    except Exception as exc:
                        logger.exception(
                            "Failed to process message offset=%d partition=%d: %s",
                            message.offset,
                            message.partition,
                            exc,
                        )
                        # Still commit to advance the offset; we've logged the
                        # failure and will publish a safe IGNORE diagnosis below.

            except NoBrokersAvailable:
                logger.warning(
                    "No Kafka brokers available at %s. Retrying in %ds...",
                    self._brokers,
                    backoff_seconds,
                )
                self._stop_event.wait(timeout=backoff_seconds)
                backoff_seconds = min(backoff_seconds * 2, max_backoff)

            except KafkaError as exc:
                logger.error("Kafka consumer error: %s. Reconnecting...", exc)
                self._stop_event.wait(timeout=backoff_seconds)

            except Exception as exc:
                logger.critical(
                    "Unhandled exception in Kafka consumer loop: %s", exc, exc_info=True
                )
                break

            finally:
                if self._consumer:
                    try:
                        self._consumer.close()
                    except Exception:
                        pass
                    self._consumer = None

    def _process_message(self, message) -> None:
        """
        Process a single aegis.logs.extracted message.

        Flow:
          1. Validate envelope structure
          2. Extract log text from payload
          3. Run local ML inference
          4. Publish aegis.ai.diagnosis.completed
          5. Publish audit event
        """
        envelope = message.value

        if not isinstance(envelope, dict):
            logger.warning("Received non-dict message, skipping.")
            return

        if envelope.get("source") == "ai-engine":
            # Avoid processing our own messages
            return

        payload = envelope.get("payload", {})
        correlation_id = envelope.get("correlationId", str(uuid.uuid4()))
        log_text = payload.get("logs", "")
        container_name = payload.get("containerName", "unknown")
        container_id = payload.get("containerId", "unknown")
        service_id = payload.get("serviceId")

        if not log_text:
            logger.warning(
                "Empty logs in aegis.logs.extracted for container=%s, skipping inference.",
                container_name,
            )
            return

        logger.info(
            "[KAFKA] Processing logs for container=%s correlationId=%s",
            container_name,
            correlation_id,
        )

        # Run inference — returns safe IGNORE fallback on any internal failure
        try:
            diagnosis = self._run_inference(log_text)
        except Exception as exc:
            logger.exception("Inference failed for container=%s: %s", container_name, exc)
            diagnosis = _safe_ignore_diagnosis(str(exc))

        # Build diagnosis event payload
        diagnosis_payload = {
            "eventId": str(uuid.uuid4()),
            "planId": str(uuid.uuid4()),  # Will be confirmed by orchestrator
            "incidentType": diagnosis.get("incidentType", "UNKNOWN"),
            "analysis": diagnosis.get("analysis", ""),
            "confidenceScore": diagnosis.get("confidenceScore", 0.0),
            "riskLevel": diagnosis.get("riskLevel", "HIGH"),
            "suggestedAction": diagnosis.get("suggestedAction", "IGNORE"),
            "reasoning": diagnosis.get("reasoning", ""),
            "embedding": diagnosis.get("embedding", []),
            "similarIncidents": diagnosis.get("similarIncidents", []),
            "containerId": container_id,
            "containerName": container_name,
            "serviceId": service_id,
            "completedAt": datetime.now(timezone.utc).isoformat(),
        }

        self._publish(
            TOPIC_AI_DIAGNOSIS_COMPLETED,
            "AI_DIAGNOSIS_COMPLETED",
            diagnosis_payload,
            correlation_id,
        )

        self._publish(
            TOPIC_AUDIT_EVENTS,
            "AUDIT_EVENT_RECORDED",
            {
                "auditId": str(uuid.uuid4()),
                "entityType": "incident",
                "entityId": payload.get("eventId", correlation_id),
                "action": "ai.diagnosis.completed",
                "status": "COMPLETED",
                "summary": (
                    f"AI classified {container_name} as "
                    f"{diagnosis_payload['incidentType']} "
                    f"(confidence={diagnosis_payload['confidenceScore']:.2f})"
                ),
                "recordedAt": datetime.now(timezone.utc).isoformat(),
                "details": {
                    "containerId": container_id,
                    "containerName": container_name,
                    "incidentType": diagnosis_payload["incidentType"],
                    "suggestedAction": diagnosis_payload["suggestedAction"],
                    "confidenceScore": diagnosis_payload["confidenceScore"],
                    "riskLevel": diagnosis_payload["riskLevel"],
                },
            },
            correlation_id,
        )

        logger.info(
            "[KAFKA] Published diagnosis for container=%s class=%s action=%s confidence=%.2f",
            container_name,
            diagnosis_payload["incidentType"],
            diagnosis_payload["suggestedAction"],
            diagnosis_payload["confidenceScore"],
        )

    def _publish(
        self,
        topic: str,
        event_type: str,
        payload: dict,
        correlation_id: str,
    ) -> None:
        """Publish an event envelope to a Kafka topic."""
        if self._producer is None:
            logger.error("Kafka producer is not initialized. Cannot publish to %s.", topic)
            return

        envelope = _build_envelope(event_type, payload, correlation_id)

        future = self._producer.send(
            topic,
            value=envelope,
            key=correlation_id.encode("utf-8"),
            headers=[
                ("event-type", event_type.encode()),
                ("source", b"ai-engine"),
                ("correlation-id", correlation_id.encode()),
            ],
        )

        try:
            future.get(timeout=10)
        except KafkaError as exc:
            logger.error("Failed to publish %s to %s: %s", event_type, topic, exc)
            raise


def _safe_ignore_diagnosis(reason: str) -> dict:
    """Returns a safe IGNORE diagnosis when inference fails."""
    return {
        "incidentType": "INFERENCE_FAILURE",
        "analysis": "AI inference pipeline failure. Cannot classify incident.",
        "confidenceScore": 0.0,
        "riskLevel": "HIGH",
        "suggestedAction": "IGNORE",
        "reasoning": f"Inference failed: {reason}. Operator intervention required.",
        "embedding": [],
        "similarIncidents": [],
    }
