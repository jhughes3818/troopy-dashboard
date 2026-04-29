"use client";

import "leaflet/dist/leaflet.css";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import { useEffect, useMemo } from "react";

type GpsPoint = {
  gps_latitude: number | null;
  gps_longitude: number | null;
  sample_time?: string;
};

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    if (positions.length > 1) {
      map.fitBounds(positions, { padding: [24, 24] });
    } else if (positions.length === 1) {
      map.setView(positions[0], 15);
    }
  }, [map, positions]);

  return null;
}

export default function GpsTraceMap({ points }: { points: GpsPoint[] }) {
  const positions = useMemo(
    () =>
      points
        .filter(
          (p) =>
            typeof p.gps_latitude === "number" &&
            typeof p.gps_longitude === "number",
        )
        .map((p) => [p.gps_latitude!, p.gps_longitude!] as [number, number]),
    [points],
  );

  if (positions.length === 0) {
    return (
      <div className="rounded-xl border p-4 text-sm text-muted-foreground">
        No GPS points available yet.
      </div>
    );
  }

  const start = positions[0];
  const end = positions[positions.length - 1];

  return (
    <div className="h-[420px] overflow-hidden rounded-xl border">
      <MapContainer
        center={end}
        zoom={14}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Polyline positions={positions} weight={4} />

        <Marker position={start}>
          <Popup>Start</Popup>
        </Marker>

        <Marker position={end}>
          <Popup>Latest position</Popup>
        </Marker>

        <FitBounds positions={positions} />
      </MapContainer>
    </div>
  );
}
