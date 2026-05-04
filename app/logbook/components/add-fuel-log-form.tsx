"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

const inputClass =
  "w-full rounded-xl border border-zinc-700/60 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none transition-colors focus:border-zinc-500 focus:ring-0";
const labelClass = "block text-xs font-medium uppercase tracking-[0.12em] text-zinc-500 mb-1.5";

export function AddFuelLogForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default filledAt to now in local time for the datetime-local input
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = e.currentTarget;
    const data = new FormData(form);

    const filledAtLocal = data.get("filledAt") as string;
    const litresRaw = data.get("litres") as string;
    const isFull = (data.get("isFull") as string) === "on";
    const odometerRaw = data.get("distanceKm") as string;
    const pricePerLRaw = data.get("pricePerL") as string;
    const notes = (data.get("notes") as string).trim();

    const litres = parseFloat(litresRaw);
    if (!filledAtLocal || isNaN(litres) || litres <= 0) {
      setError("Date and a positive litres value are required.");
      setLoading(false);
      return;
    }

    const body: Record<string, unknown> = {
      filledAt: new Date(filledAtLocal).toISOString(),
      litres,
      isFull,
    };
    if (odometerRaw) body.distanceKm = parseFloat(odometerRaw);
    if (pricePerLRaw) body.pricePerL = parseFloat(pricePerLRaw);
    if (notes) body.notes = notes;

    try {
      const res = await fetch("/api/logbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Failed to save entry.");
        setLoading(false);
        return;
      }
    } catch {
      setError("Network error — please try again.");
      setLoading(false);
      return;
    }

    form.reset();
    router.refresh();
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="filledAt" className={labelClass}>
            Date & Time
          </label>
          <input
            id="filledAt"
            name="filledAt"
            type="datetime-local"
            defaultValue={nowLocal}
            required
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="litres" className={labelClass}>
            Litres Added
          </label>
          <input
            id="litres"
            name="litres"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="e.g. 45.50"
            required
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="distanceKm" className={labelClass}>
            Distance Since Last Fill (km) <span className="normal-case text-zinc-600">optional</span>
          </label>
          <input
            id="distanceKm"
            name="distanceKm"
            type="number"
            step="1"
            min="0"
            placeholder="e.g. 450"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="pricePerL" className={labelClass}>
            Price per Litre ($) <span className="normal-case text-zinc-600">optional</span>
          </label>
          <input
            id="pricePerL"
            name="pricePerL"
            type="number"
            step="0.001"
            min="0"
            placeholder="e.g. 1.899"
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="notes" className={labelClass}>
            Notes <span className="normal-case text-zinc-600">optional</span>
          </label>
          <input
            id="notes"
            name="notes"
            type="text"
            placeholder="e.g. BP on Pacific Highway"
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            name="isFull"
            type="checkbox"
            defaultChecked
            className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 accent-amber-400"
          />
          <span className="text-sm text-zinc-300">Filled to full</span>
        </label>

        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-amber-300 disabled:opacity-60"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {loading ? "Saving…" : "Log Fill-up"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
