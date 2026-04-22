# Victron SmartShunt Telemetry Dashboard

Small Next.js App Router app for receiving Victron SmartShunt telemetry over HTTP, storing it in Supabase Postgres via Prisma, and viewing latest + history readings.

## Stack

- Next.js (App Router, TypeScript)
- Prisma ORM
- Supabase Postgres

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your local env file and configure Supabase + ingest auth:

```bash
cp .env.example .env
```

Required variables:

- `DATABASE_URL`: Supabase Postgres connection string used by Prisma.
- `INGEST_API_KEY`: Shared key required by `POST /api/victron` uploads.

3. Run Prisma migration against Supabase:

```bash
npx prisma migrate deploy
```

4. Start the app so devices on your LAN can reach it:

```bash
npm run dev -- --hostname 0.0.0.0
```

5. API endpoint for Arduino:

`http://<laptop-ip>:3000/api/victron`

## API

### `POST /api/victron`

Requires header:

- `x-ingest-key: <INGEST_API_KEY>`

Accepts either:

- a single telemetry payload (legacy/single mode), or
- a batch envelope with `records: [...]`.

Single telemetry payload:

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

Nullable numeric values can be `null`.

Example curl:

```bash
curl -X POST "http://localhost:3000/api/victron" \
  -H "Content-Type: application/json" \
  -H "x-ingest-key: your-shared-ingest-key" \
  -d '{
    "device_id": "smartshunt-1",
    "voltage": 13.1,
    "current": -4.2,
    "soc": 87.5,
    "power": -55.0,
    "aux_voltage": 13.0,
    "ttg_days": 1.8,
    "timestamp_ms": 1713763200000
  }'
```

Batch payload:

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
    },
    {
      "device_id": "smartshunt-1",
      "voltage": 13.0,
      "current": -3.9,
      "soc": 87.4,
      "power": -50.7,
      "aux_voltage": 13.0,
      "ttg_days": 1.7,
      "timestamp_ms": 1713763260000
    }
  ]
}
```

Batch example curl:

```bash
curl -X POST "http://localhost:3000/api/victron" \
  -H "Content-Type: application/json" \
  -H "x-ingest-key: your-shared-ingest-key" \
  -d '{
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
  }'
```

Batch response includes replay-safe acknowledgement fields:

- `accepted`: newly inserted records
- `duplicates`: records skipped due to existing `(device_id, timestamp_ms)`
- `rejected`: invalid records
- `errors`: optional per-record validation errors (`index`, `error`)

Limits:

- max request body size: `1,000,000` bytes
- max records per batch: `100`

### `GET /api/victron`

Returns recent readings (newest first).

Optional query:

- `limit` (default `50`, max `500`)

### `GET /api/victron/latest`

Returns newest reading only (or `null` if no rows exist).

## Dashboard

- `/` shows:
  - Latest reading card
  - History table
- Auto-refresh every 5 seconds via a tiny client polling component that triggers `router.refresh()`.

## Arduino Offline Buffering Strategy

Recommended firmware behavior for intermittent Wi-Fi:

1. If online, POST each reading immediately.
2. If offline or upload fails, append reading to local persistent buffer.
3. On reconnect, send buffered records in batches (up to `100` records/request).
4. Use response ack counters to drop acknowledged records and retry only unacknowledged ones.
5. Use backoff between retries to avoid request storms on unstable links.
