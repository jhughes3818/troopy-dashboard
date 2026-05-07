"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";

export function DeleteWaterLogButton({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm("Delete this water fill entry?")) return;
    setLoading(true);
    await fetch(`/api/water/${id}`, { method: "DELETE" });
    router.refresh();
    setLoading(false);
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="rounded-lg p-1.5 text-zinc-600 transition-colors hover:text-red-400 disabled:opacity-50"
      aria-label="Delete entry"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </button>
  );
}
