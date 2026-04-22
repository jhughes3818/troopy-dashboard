# Arduino Telemetry Upload Requirements

This document defines the requirements for any Arduino device sending telemetry to this dashboard backend.

## 1) Endpoint and Method

- **Method:** `POST`
- **URL:** `http://<server-host>:3000/api/victron`
- **Content-Type:** `application/json`

## 2) Authentication Requirement

Every upload request must include the shared ingest key header:

- `x-ingest-key: <INGEST_API_KEY>`

If the key is missing or invalid, the API returns `401 Unauthorized`.

## 3) Supported Payload Formats

The API accepts either:

- a single telemetry object, or
- a batch object with a `records` array.

### 3.1 Single record payload

```json
{
  "device_id": "smartshunt-1",
  "voltage": 13.1,
  "current": -4.2,
  "soc": 87.5,
  "power": -55.0,
  "aux_voltage": 13.0,
  "ttg_days": 1.8,
  "timestamp_ms": 1713763200000
}
```

### 3.2 Batch payload

```json
{
  "records": [
    {
      "device_id": "smartshunt-1",
      "voltage": 13.1,
      "current": -4.2,
      "soc": 87.5,
      "power": -55.0,
      "aux_voltage": 13.0,
      "ttg_days": 1.8,
      "timestamp_ms": 1713763200000
    }
  ]
}
```

## 4) Field Validation Rules

For each record:

- `device_id`: required, non-empty string
- `timestamp_ms`: required, integer number (Unix time in milliseconds)
- `voltage`, `current`, `soc`, `power`, `aux_voltage`, `ttg_days`: must be a finite number or `null`

## 5) Batch and Request Limits

- Maximum records per batch: `100`
- Maximum request size: `1,000,000` bytes
- Empty batch arrays are rejected

## 6) Idempotency and Duplicate Handling

Server deduplication key:

- `(device_id, timestamp_ms)`

This means the device can safely retry uploads without creating duplicate rows. Replayed records are counted as duplicates.

## 7) Response Contract (Upload ACK)

Successful upload responses include acknowledgement fields to support buffer management:

- `accepted`: newly inserted records
- `duplicates`: already-existing records skipped by server
- `rejected`: invalid records
- `errors`: optional list of `{ index, error }` for rejected records

For single-record mode, the response also includes `reading`.

## 8) Required Device Behavior (Connectivity Aware)

Arduino firmware must implement:

1. **Online mode:** send each reading immediately.
2. **Offline mode:** store readings in local persistent buffer.
3. **Reconnect mode:** flush buffered records in batches (up to 100).
4. **ACK handling:** remove records acknowledged as accepted or duplicates.
5. **Retry strategy:** retry unacknowledged records with exponential backoff.

## 9) Error Handling Requirements

- `400`: payload format/field validation error. Firmware should log and drop/fix invalid records.
- `401`: auth failure. Firmware should stop retries until key/config is corrected.
- `413`: request too large. Firmware should reduce batch size.
- `5xx`: transient server issue. Firmware should retry with backoff.

## 10) Time and Ordering Guidance

- Device should produce monotonic `timestamp_ms` values where possible.
- Batch ordering should be oldest-first for easier replay tracking.

## 11) Transport and Security Recommendations

- Use HTTPS in production deployments.
- Keep the shared ingest key out of source control.
- Rotate ingest key if compromise is suspected.

## 12) Firmware Checklist

- [ ] Add `x-ingest-key` header on every request.
- [ ] Serialize valid JSON with required fields.
- [ ] Implement persistent local queue for offline operation.
- [ ] Enforce max batch size of 100 records.
- [ ] Parse ACK response and prune local queue correctly.
- [ ] Implement exponential backoff and retry limits.
