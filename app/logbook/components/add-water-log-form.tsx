"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

const inputClass =
  "w-full rounded-xl border border-zinc-700/60 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none transition-colors focus:border-zinc-500 focus:ring-0";
const labelClass = "block text-xs font-medium uppercase tracking-[0.12em] text-zinc-500 mb-1.5";

export function AddWaterLogForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const notes = (data.get("notes") as string).trim();

    if (!filledAtLocal) {
      setError("Date is required.");
      setLoading(false);
      return;
    }

    const body: Record<string, unknown> = {
      filledAt: new Date(filledAtLocal).toISOString(),
    };
    if (notes) body.notes = notes;

    try {
      const res = await fetch("/api/water", {
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
          <label htmlFor="water-filledAt" className={labelClass}>
            Date & Time
          </label>
          <input
            id="water-filledAt"
            name="filledAt"
            type="datetime-local"
            defaultValue={nowLocal}
            required
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="water-notes" className={labelClass}>
            Notes <span className="normal-case text-zinc-600">optional</span>
          </label>
          <input
            id="water-notes"
            name="notes"
            type="text"
            placeholder="e.g. Campsite tap"
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-sky-400 disabled:opacity-60"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {loading ? "Saving…" : "Filled to Full (45 L)"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
