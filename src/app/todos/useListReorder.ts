"use client";

import { useRef, useState } from "react";

// Reordering the task list by dragging a row's handle with a mouse, finger or pen. Rows that can
// move carry data-reorder-id; the one being dragged follows the pointer and a line shows where it
// will land. `onCommit` gets the task and the one it goes before (null = the end).
export type ListReorder = ReturnType<typeof useListReorder>;
export function useListReorder(onCommit: (id: string, before: string | null) => void) {
  const [drag, setDrag] = useState<{ id: string; dy: number; before: string | null } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const start = (e: React.PointerEvent, id: string) => {
    if (e.button > 0) return;
    e.preventDefault(); // keeps the row's native drag (to the planner) from starting
    const startY = e.clientY;
    let before: string | null | undefined;
    const move = (ev: PointerEvent) => {
      // Near the top or bottom edge, scroll the page so a long list can be dragged through.
      if (ev.clientY < 80) window.scrollBy(0, -14);
      else if (ev.clientY > window.innerHeight - 80) window.scrollBy(0, 14);
      const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-reorder-id]") ?? []).filter(
        (r) => r.dataset.reorderId !== id
      );
      const next = rows.find((r) => {
        const box = r.getBoundingClientRect();
        return ev.clientY < box.top + box.height / 2;
      });
      before = next?.dataset.reorderId ?? null;
      setDrag({ id, dy: ev.clientY - startY, before });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", cancel);
      setDrag(null);
      if (commit && before !== undefined) onCommit(id, before);
    };
    const drop = () => finish(true);
    const cancel = () => finish(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", cancel);
  };

  return { drag, listRef, start };
}
