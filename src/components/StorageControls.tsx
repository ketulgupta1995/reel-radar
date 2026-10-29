"use client";

import { useRef } from "react";
import { State, clearDiscoveryHistory, exportData, importData, reset } from "@/lib/storage";

export function StorageControls({
  onStateChange,
  onHistoryCleared,
}: {
  onStateChange?: (s: State) => void;
  // Shows the "Clear Displayed & Shown" button when given; called after the history is cleared so Discover can reload its batches.
  onHistoryCleared?: (s: State) => void;
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
      {onHistoryCleared && (
        <button
          onClick={() => {
            if (
              confirm(
                "Clear displayed and shown titles history? (Your watched list, watchlist, and dismissed titles will be kept)"
              )
            ) {
              const refreshed = clearDiscoveryHistory();
              if (onStateChange) onStateChange(refreshed);
              onHistoryCleared(refreshed);
            }
          }}
          className="rounded border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-xs text-blue-300 transition hover:text-blue-200"
        >
          Clear Displayed &amp; Shown
        </button>
      )}
      <button
        onClick={() => {
          if (confirm("Reset ALL data including watched history and watchlist?")) {
            reset().then(() => location.reload());
          }
        }}
        className="text-xs text-white/50 underline hover:text-red-400"
      >
        Reset All
      </button>
    </div>
  );
}