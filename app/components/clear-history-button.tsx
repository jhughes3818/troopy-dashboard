"use client";

import { useState } from "react";

export function ClearHistoryButton() {
  const [isClearing, setIsClearing] = useState(false);

  async function handleClear() {
    if (isClearing) return;

    setIsClearing(true);

    try {
      const response = await fetch("/api/victron/clear", { method: "POST" });
      if (!response.ok) {
        throw new Error("Failed to clear telemetry history.");
      }

      window.location.reload();
    } catch (error) {
      console.error(error);
      setIsClearing(false);
      window.alert("Could not clear history.");
    }
  }

  return (
    <button
      type="button"
      onClick={handleClear}
      disabled={isClearing}
      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
    >
      {isClearing ? "Clearing..." : "Dev tool: Clear history"}
    </button>
  );
}
