"use client";

import { useRef } from "react";
import { State, exportData, importData } from "@/lib/storage";

export function StorageControls({
  onStateChange,
}: {
  onStateChange?: (s: State) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    importData(
      file,
      (merged) => {
        alert("Backup imported successfully! Data merged.");
        if (onStateChange) onStateChange(merged);
      },
      (err) => alert(err)
    );

    // Reset input value so re-importing the same file works
    e.target.value = "";
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
      />
      <button
        onClick={exportData}
        title="Download JSON backup of your watched titles and watchlist"
        className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs text-white/80 transition hover:border-gold hover:text-white"
      >
        Export
      </button>
      <button
        onClick={() => fileInputRef.current?.click()}
        title="Import and merge titles from a JSON backup file"
        className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs text-white/80 transition hover:border-gold hover:text-white"
      >
        Import
      </button>
    </div>
  );
}