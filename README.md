# Victron SmartShunt Telemetry Dashboard

Small Next.js App Router app for receiving Victron SmartShunt telemetry over HTTP, storing it in SQLite via Prisma, and viewing latest + history readings.

## Stack

- Next.js (App Router, TypeScript)
- Prisma ORM
- SQLite (`prisma/dev.db`)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your local env file:

```bash
cp .env.example .env
```

3. Run initial Prisma migration:

```bash
npx prisma migrate dev --name init_telemetry
```

4. Start the app so devices on your LAN can reach it:

```bash
npm run dev -- --hostname 0.0.0.0
```

5. API endpoint for Arduino:

`http://<laptop-ip>:3000/api/victron`

## API

### `POST /api/victron`

Accepts telemetry payload:

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
