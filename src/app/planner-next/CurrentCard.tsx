"use client";

import { useEffect, useState } from "react";
import { DEFAULT_DURATION, loadTodos, type FocusSession, type Todo } from "@/lib/todos";
import { todayCard } from "@/lib/plannerToday";
import { tagColor, tagLabel } from "@/lib/plannerSettings";
import { fmtDuration, fmtTime } from "../todos/planner";

// 5:07 / 1:02:30
export function fmtClock(totalSeconds: number): string {
  const s = Math.floor(Math.abs(totalSeconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm.padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

// The time now in ms, redrawn every second while `on`, so only the card ticks, not the page.
export function useClock(on: boolean): number {
  const [ms, setMs] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setMs(Date.now());
    const id = setInterval(() => setMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [on]);
  return ms;
}

// A focus session's clock: time left of the block's planned length, or time spent when it has none.
export function focusClock(session: FocusSession, nowMs: number) {
  const todo = loadTodos(session.date).find((t) => t.id === session.todoId);
  const elapsed = Math.max(0, (nowMs - session.startedAt) / 1000);
  const spentBefore = (todo?.spent ?? 0) * 60;
  const planned = todo?.start !== undefined ? (todo.duration ?? DEFAULT_DURATION) * 60 : null;
  const remaining = planned === null ? null : planned - spentBefore - elapsed;
  return {
    todo,
    over: remaining !== null && remaining < 0,
    clock: remaining === null ? fmtClock(spentBefore + elapsed) : `${remaining < 0 ? "+" : ""}${fmtClock(remaining)}`,
    note: remaining === null ? "spent so far" : remaining < 0 ? `over the ${fmtDuration(planned! / 60)} planned` : `left of ${fmtDuration(planned! / 60)} planned`,
  };
}

const KICKER = "font-bfm text-[10.5px] font-bold uppercase tracking-[.08em] opacity-75";
const BIG = "font-bfm text-2xl font-bold leading-none tracking-tight tabular-nums";
const BTN = "flex-1 rounded-[10px] px-2 py-2 text-[13px] font-extrabold";

// The top of Today: what's under way, the free time before the next block, a wrap-up, or all done.
export function CurrentCard({
  todos,
  now,
  focus,
  onFinish,
  onFocus,
  onStopFocus,
  onOpenFocus,
  onWrapUp,
}: {
  todos: Todo[];
  now: number;
  focus: FocusSession | null;
  onFinish: (todo: Todo) => void;
  onFocus: (todo: Todo) => void;
  onStopFocus: (markDone: boolean) => void;
  onOpenFocus?: () => void;
  onWrapUp: () => void;
}) {
  const card = todayCard(todos, now);
  const ticking = Boolean(focus) || card?.kind === "block";
  const nowMs = useClock(ticking);

  if (focus) {
    const f = focusClock(focus, nowMs);
    return (
      <section aria-label="Focusing" className="rounded-2xl px-3.5 py-3 text-bf-ontag" style={{ background: tagColor(f.todo?.tag ?? "") }}>
        <div className={KICKER}>Focusing{f.todo?.tag ? ` · ${tagLabel(f.todo.tag)}` : ""}</div>
        <h2 className="mt-1 break-words text-xl font-black leading-tight [font-stretch:110%]">{focus.text}</h2>
        <div className="mt-1 flex items-baseline gap-2">
          <span className={BIG} data-testid="focus-clock">
            {f.clock}
          </span>
          <span className="font-bfm text-[11px] opacity-80">{f.note}</span>
        </div>
        <div className="mt-2.5 flex gap-1.5">
          {onOpenFocus && (
            <button onClick={onOpenFocus} className={`${BTN} bg-bf-ontag text-white`}>
              Open focus
            </button>
          )}
          <button onClick={() => onStopFocus(false)} className={`${BTN} bg-black/15`}>
            Stop
          </button>
          <button onClick={() => onStopFocus(true)} className={`${BTN} bg-black/15`}>
            Finish
          </button>
        </div>
      </section>
    );
  }

  if (!card) return null;

  if (card.kind === "block") {
    const left = card.end * 60 - Math.floor((nowMs - new Date(nowMs).setHours(0, 0, 0, 0)) / 1000);
    return (
      <section aria-label="Under way" className="rounded-2xl px-3.5 py-3 text-bf-ontag" style={{ background: tagColor(card.todo.tag ?? "") }}>
        <div className={KICKER}>Under way{card.todo.tag ? ` · ${tagLabel(card.todo.tag)}` : ""}</div>
        <h2 className="mt-1 break-words text-xl font-black leading-tight [font-stretch:110%]">{card.todo.text}</h2>
        <div className="mt-1 flex items-baseline gap-2">
          <span className={BIG}>{fmtClock(Math.max(0, left))}</span>
          <span className="font-bfm text-[11px] opacity-80">left · ends {fmtTime(card.end)}</span>
        </div>
        <div className="mt-2.5 flex gap-1.5">
          <button onClick={() => onFinish(card.todo)} className={`${BTN} bg-bf-ontag text-white`}>
            Finish
          </button>
          <button onClick={() => onFocus(card.todo)} className={`${BTN} bg-black/15`}>
            ▶ Focus
          </button>
        </div>
      </section>
    );
  }

  if (card.kind === "done")
    return (
      <section aria-label="All done" className="rounded-2xl bg-gold px-3.5 py-3 text-bf-ontag">
        <div className={KICKER}>All done</div>
        <h2 className="mt-1 text-xl font-black [font-stretch:110%]">Everything&apos;s finished</h2>
        <p className="mt-1 font-bfm text-[11px] opacity-80">
          {card.count} {card.count === 1 ? "task" : "tasks"} done
        </p>
        <div className="mt-2.5 flex">
          <button onClick={onWrapUp} className={`${BTN} bg-bf-ontag text-white`}>
            Fill in the day log
          </button>
        </div>
      </section>
    );

  const plain = "rounded-2xl bg-bf-s1 px-3.5 py-3 ring-1 ring-bf-s2";
  if (card.kind === "wrap")
    return (
      <section aria-label="Wrap up" className={plain}>
        <div className={KICKER}>Evening</div>
        <h2 className="mt-1 text-xl font-black [font-stretch:110%]">Wrap up the day</h2>
        <p className="mt-1 font-bfm text-[11px] text-bf-muted">{card.open} still open</p>
        <div className="mt-2.5 flex">
          <button onClick={onWrapUp} className={`${BTN} bg-bf-ink text-bf-bg`}>
            Sleep, weight and notes
          </button>
        </div>
      </section>
    );

  return (
    <section aria-label="Free time" className={plain}>
      <div className={KICKER}>Free time</div>
      <h2 className="mt-1 text-xl font-black [font-stretch:110%]">{card.next ? `Free until ${fmtTime(card.next.start!)}` : "No blocks left"}</h2>
      {card.next && (
        <p className="mt-1 font-bfm text-[11px] text-bf-muted">
          {fmtDuration(card.next.start! - now)} · then {card.next.text}
        </p>
      )}
      {card.anytime.length > 0 && (
        <ul className="mt-2.5 flex flex-col gap-1">
          {card.anytime.map((t) => (
            <li key={t.id}>
              <button onClick={() => onFocus(t)} aria-label={`Start “${t.text}”`} className="flex w-full justify-between gap-2.5 rounded-[9px] bg-bf-s2 px-2.5 py-2 text-left text-[12.5px] font-bold">
                <span className="min-w-0 break-words">{t.text}</span>
                <span className="shrink-0 font-bfm text-[11px] text-bf-muted">▶ Start</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
