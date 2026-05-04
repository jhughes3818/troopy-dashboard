"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

const inputClass =
  "w-full rounded-xl border border-zinc-700/60 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none transition-colors focus:border-zinc-500";
const labelClass = "block text-xs font-medium uppercase tracking-[0.12em] text-zinc-500 mb-1.5";

type Props = { currentCapacity: number | null };

export function TankCapacityForm({ currentCapacity }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setLoading(true);

    const form = e.currentTarget;
    const data = new FormData(form);
    const raw = data.get("tankCapacityL") as string;
    const tankCapacityL = parseFloat(raw);

    if (isNaN(tankCapacityL) || tankCapacityL <= 0) {
      setError("Enter a positive tank capacity.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tankCapacityL }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Failed to save.");
        setLoading(false);
        return;
      }
    } catch {
      setError("Network error — please try again.");
      setLoading(false);
      return;
    }

    setSaved(true);
    router.refresh();
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3">
      <div className="w-48">
        <label htmlFor="tankCapacityL" className={labelClass}>
          Tank Capacity (L)
        </label>
        <input
          id="tankCapacityL"
          name="tankCapacityL"
          type="number"
          step="1"
          min="1"
          defaultValue={currentCapacity ?? ""}
          placeholder="e.g. 180"
          required
          className={inputClass}
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="flex items-center gap-2 rounded-xl bg-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-600 disabled:opacity-60"
      >
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Save
      </button>
      {saved && <span className="text-xs text-emerald-400">Saved</span>}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </form>
  );
}
