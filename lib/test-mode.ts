// Set to true to use mock data instead of the database. No DB queries run in test mode.
export const TEST_MODE = false;

export const MOCK_VEHICLE_PROFILE = {
  id: "vehicle",
  tankCapacityL: 180,
};

// Six entries across ~3 months. distanceKm = km driven since the previous fill-up.
// Segment 1 (mock-1 → mock-3): (420 + 660) = 1080 km, 160L → 14.8 L/100km
// Segment 2 (mock-3 → mock-5): (500 + 640) = 1140 km, 165L → 14.5 L/100km
// Distance since last full (mock-6): 234 km
export const MOCK_FUEL_LOGS = [
  {
    id: "mock-1",
    filledAt: new Date("2026-02-10T08:30:00"),
    litres: 155,
    isFull: true,
    distanceKm: null,
    pricePerL: 2.1,
    notes: "Filled up in Longreach",
    createdAt: new Date("2026-02-10T08:30:00"),
  },
  {
    id: "mock-2",
    filledAt: new Date("2026-03-05T14:15:00"),
    litres: 40,
    isFull: false,
    distanceKm: 420,
    pricePerL: 2.05,
    notes: "Quick top-up at Barcaldine",
    createdAt: new Date("2026-03-05T14:15:00"),
  },
  {
    id: "mock-3",
    filledAt: new Date("2026-03-18T11:00:00"),
    litres: 120,
    isFull: true,
    distanceKm: 660,
    pricePerL: 1.95,
    notes: "Emerald servo",
    createdAt: new Date("2026-03-18T11:00:00"),
  },
  {
    id: "mock-4",
    filledAt: new Date("2026-04-22T09:45:00"),
    litres: 50,
    isFull: false,
    distanceKm: 500,
    pricePerL: null,
    notes: null,
    createdAt: new Date("2026-04-22T09:45:00"),
  },
  {
    id: "mock-5",
    filledAt: new Date("2026-05-01T16:20:00"),
    litres: 115,
    isFull: true,
    distanceKm: 640,
    pricePerL: 2.15,
    notes: "Filled in Clermont",
    createdAt: new Date("2026-05-01T16:20:00"),
  },
  {
    id: "mock-6",
    filledAt: new Date("2026-05-03T11:00:00"),
    litres: 30,
    isFull: false,
    distanceKm: 234,
    pricePerL: 2.18,
    notes: "Quick top-up",
    createdAt: new Date("2026-05-03T11:00:00"),
  },
] as const;
