import Link from "next/link";
import { ReactNode } from "react";
import { Summary } from "@/lib/pianoDrill";
import { KeySpeed, NoteSpeed, SpeedBand } from "@/lib/pianoNoteSpeed";
import { RhythmSummary } from "@/lib/pianoRhythm";
import { TouchStats, touchLine } from "@/lib/pianoTouch";
import type { SongResult } from "./songs/SongPlayer";

// The results screen: one card per finished step and, for sessions that included the note drill, the note-speed
// keyboard under them. It renders in the Stage's middle area (the stage scrolls it when it is taller).
//
//   <Results title="Round done" cards={[{ kind: "drill", tag: "Note drill", summary, prevAvgMs }]} noteSpeed={noteSpeed(stats)}
//            primary={{ label: "Done", href: "/piano" }} secondary={{ label: "Another round", onClick: again }} />
//
// - cards: drill (Summary from DrillRound.finish; prevAvgMs = the previous round's mean reaction, null/absent = none),
//   rhythm (RhythmSummary), song (a SongPlayer SongResult; tag from songTag(title, hands)). tag is the small label on top.
// - noteSpeed: output of noteSpeed(statsFrom(...)); omit it (or null) for no keyboard.
// - primary / secondary: a button, or a link when href is set.
export type DrillCardData = { kind: "drill"; tag: string; summary: Summary; prevAvgMs?: number | null; touch?: TouchStats | null };
export type RhythmCardData = { kind: "rhythm"; tag: string; summary: RhythmSummary };
export type SongCardData = { kind: "song"; tag: string; result: SongResult }; // tag: songTag(title, hands)
export type ResultCard = DrillCardData | RhythmCardData | SongCardData;
export type ResultAction = { label: string; href?: string; onClick?: () => void };
export type ResultsProps = { title?: string; cards: readonly ResultCard[]; noteSpeed?: NoteSpeed | null; primary?: ResultAction; secondary?: ResultAction };

const sec = (ms: number, digits = 1) => `${(ms / 1000).toFixed(digits)} s`;
const good = "text-emerald-300";
const warn = "text-[#ffcfbf]";
const HANDS = { R: "R hand", L: "L hand", both: "both hands" } as const;

function Action({ a, primary }: { a: ResultAction; primary?: boolean }) {
  const cls = primary ? "rounded-full bg-pn-brass px-6 py-2.5 font-semibold text-pn-ebony hover:brightness-110" : "rounded-full border border-pn-ivory/30 px-5 py-2.5 text-sm text-pn-ivory hover:bg-pn-ivory/10";
  return a.href ? (
    <Link href={a.href} onClick={a.onClick} className={cls}>
      {a.label}
    </Link>
  ) : (
    <button type="button" onClick={a.onClick} className={cls}>
      {a.label}
    </button>
  );
}

const Stat = ({ label, value, testid }: { label: string; value: string; testid?: string }) => (
  <div>
    <dt className="text-xs text-pn-ivory/60">{label}</dt>
    <dd data-testid={testid} className="font-pnd text-3xl font-semibold tabular-nums">
      {value}
    </dd>
  </div>
);

function Shell({ tag, children }: { tag: string; children: ReactNode }) {
  return (
    <li data-testid="result-card" className="space-y-2 rounded-xl border border-pn-line bg-pn-felt p-4">
      <p className="text-[11px] uppercase tracking-[0.1em] text-pn-brass">{tag}</p>
      {children}
    </li>
  );
}

function DrillCard({ c }: { c: DrillCardData }) {
  const { summary: s, prevAvgMs: prev } = c;
  if (!s.attempts)
    return (
      <Shell tag={c.tag}>
        <p className="text-sm text-pn-ivory/70">No answers this round, so nothing was saved.</p>
      </Shell>
    );
  const diff = prev != null && s.avgMs > 0 ? s.avgMs - prev : null;
  return (
    <Shell tag={c.tag}>
      <dl className="grid grid-cols-2 gap-3">
        <Stat label="Accuracy" value={`${Math.round(s.accuracy * 100)}%`} testid="accuracy" />
        <Stat label="Avg reaction" value={`${(s.avgMs / 1000).toFixed(2)} s`} testid="reaction" />
      </dl>
      {diff !== null && (
        <p data-testid="reaction-vs" className={`text-sm ${diff < -50 ? good : diff > 50 ? warn : "text-pn-ivory/70"}`}>
          {diff < -50 ? `Faster than last round (was ${sec(prev!)})` : diff > 50 ? `Slower than last round (was ${sec(prev!)})` : `Same as last round (${sec(prev!)})`}
        </p>
      )}
      <p className="text-xs text-pn-ivory/60">{s.attempts} answers</p>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-pn-ivory/60">Weakest</h3>
        {s.weakest.length ? (
          <ol data-testid="weakest" className="mt-1 space-y-0.5 text-sm text-pn-ivory/80">
            {s.weakest.map((w) => (
              <li key={w.id}>
                {w.label}: {w.misses} missed, {w.slow} slow, of {w.attempts}
              </li>
            ))}
          </ol>
        ) : (
          <p className={`text-sm ${good}`}>None. A clean round.</p>
        )}
      </div>
      {s.unlockedNow.map((g) => (
        <p key={g} className={`text-sm ${good}`}>
          Unlocked: {g}
        </p>
      ))}
      {c.touch && <TouchBlock t={c.touch} />}
    </Shell>
  );
}

// Evenness of touch: the score and one bar per finger (how hard it struck on average, velocity out of 127).
export function TouchBlock({ t }: { t: TouchStats }) {
  return (
    <div data-testid="touch" className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-pn-ivory/60">Evenness of touch</h3>
      <p className="flex items-baseline gap-2">
        <b data-testid="evenness" className="font-pnd text-2xl font-semibold tabular-nums">
          {t.evenness}
        </b>
        <span className="text-xs text-pn-ivory/60">of 100 · {t.n} notes, velocity ±{t.spread}</span>
      </p>
      <ul aria-label="Velocity by finger" className="m-0 flex h-16 list-none items-end gap-2 p-0">
        {[1, 2, 3, 4, 5].map((f) => {
          const x = t.fingers.find((y) => y.finger === f);
          const tone = f === t.weak ? "bg-orange-400" : f === t.strong ? "bg-sky-300" : "bg-pn-ivory/80";
          return (
            <li key={f} data-testid={`finger-${f}`} aria-label={x ? `Finger ${f}: velocity ${x.mean}` : `Finger ${f}: not played`} className="flex h-full w-7 flex-col items-center justify-end gap-0.5">
              <span className={`w-full rounded-t-sm ${x ? tone : "bg-pn-line"}`} style={{ height: `${x ? Math.max(6, Math.round((x.mean / 127) * 100)) : 4}%` }} />
              <span className="text-[10px] text-pn-ivory/70">{f}</span>
            </li>
          );
        })}
      </ul>
      <p data-testid="touch-line" className="text-sm text-pn-ivory/80">
        {touchLine(t)}
      </p>
    </div>
  );
}

function RhythmCard({ c }: { c: RhythmCardData }) {
  const s = c.summary;
  if (!s.attempts)
    return (
      <Shell tag={c.tag}>
        <p className="text-sm text-pn-ivory/70">No patterns finished this round, so nothing was saved.</p>
      </Shell>
    );
  return (
    <Shell tag={c.tag}>
      <dl className="grid grid-cols-2 gap-3">
        <Stat label="On time" value={`${Math.round(s.onTimeRate * 100)}%`} testid="ontime-total" />
        <Stat label="Avg error" value={`${s.avgMs} ms`} testid="error" />
      </dl>
      <p className="text-xs text-pn-ivory/60">{s.attempts} patterns</p>
      <p className="text-xs text-pn-ivory/60">On-time window now ±{s.windowMs} ms</p>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-pn-ivory/60">Weakest</h3>
        {s.weakest.length ? (
          <ol data-testid="weakest" className="mt-1 space-y-0.5 text-sm text-pn-ivory/80">
            {s.weakest.map((w) => (
              <li key={w.id}>
                {w.label}: {w.misses} off, of {w.attempts}
              </li>
            ))}
          </ol>
        ) : (
          <p className={`text-sm ${good}`}>None. A clean round.</p>
        )}
      </div>
      {s.unlockedNow.map((g) => (
        <p key={g} className={`text-sm ${good}`}>
          Unlocked: {g}
        </p>
      ))}
    </Shell>
  );
}

function SongCard({ c }: { c: SongCardData }) {
  const r = c.result;
  const next = r.ladder;
  let big: string;
  let unit: string;
  if (r.early) {
    big = "Stopped";
    unit = r.mode === "play" ? `at ${r.bpm} BPM` : `${r.wait?.played ?? 0}/${r.wait?.total ?? 0} steps`;
  } else if (r.play) {
    big = `${Math.round(r.play.summary.onTimePct * 100)}%`;
    unit = `on time at ${r.bpm} BPM`;
  } else {
    big = String(r.wait?.misses ?? 0);
    unit = (r.wait?.misses ?? 0) === 1 ? "miss" : "misses";
  }
  let line: string | null = null;
  let tone = good;
  if (r.early) {
    line = "Stopped runs don't move the ladder";
    tone = "text-pn-ivory/70";
  } else if (next?.mastered) line = "Mastered: both hands at full tempo";
  else if (next?.stepDone) line = "Step done";
  else if (next?.tempo != null) {
    line = next.tempo > r.bpm ? `Ladder up: next time ${next.tempo} BPM` : `Next time ${next.tempo} BPM`;
    if (next.tempo <= r.bpm) tone = warn;
  } else if (next) {
    line = "Not through this step yet";
    tone = warn;
  }
  return (
    <Shell tag={c.tag}>
      <p className="flex items-baseline gap-2">
        <b data-testid="song-big" className="font-pnd text-3xl font-semibold tabular-nums">
          {big}
        </b>
        <span className="text-sm text-pn-ivory/70">{unit}</span>
      </p>
      {line && (
        <p data-testid="song-line" className={`text-sm ${tone}`}>
          {line}
        </p>
      )}
    </Shell>
  );
}

// "F# and A# are still slow" / "F#, A# and D# are still slow".
export function slowLine(slow: readonly string[]): string {
  const names = slow.length > 1 ? `${slow.slice(0, -1).join(", ")} and ${slow[slow.length - 1]}` : slow[0];
  return `${names} ${slow.length > 1 ? "are" : "is"} still slow: tomorrow's warm-up.`;
}

const BAND: Record<SpeedBand, { bg: string; text: string; label: string }> = {
  fast: { bg: "bg-sky-300", text: "text-pn-ebony", label: "under 1 s" },
  ok: { bg: "bg-pn-ivory", text: "text-pn-ebony", label: "1 to 2 s" },
  slow: { bg: "bg-orange-400", text: "text-pn-ebony", label: "over 2 s or missed" },
  none: { bg: "bg-neutral-600", text: "text-pn-ivory/80", label: "no data" },
};
const WHITES = [0, 2, 4, 5, 7, 9, 11];
const BLACK_AFTER: Record<number, number> = { 1: 1, 3: 2, 6: 4, 8: 5, 10: 6 }; // black pc -> number of whites to its left
const WW = 100 / 7;

function timeText(k: KeySpeed, tight: boolean) {
  if (k.avgMs !== null) return sec(k.avgMs);
  if (k.band === "slow") return "missed";
  return tight ? "–" : "no data";
}

function SpeedKey({ k }: { k: KeySpeed }) {
  const black = k.name.includes("#");
  const b = BAND[k.band];
  const text = timeText(k, black);
  const style = black ? { left: `${BLACK_AFTER[k.pc] * WW - WW * 0.31}%`, width: `${WW * 0.62}%`, height: "60%" } : { left: `${WHITES.indexOf(k.pc) * WW}%`, width: `${WW}%`, height: "100%" };
  return (
    <div
      data-testid={`key-${k.name}`}
      data-band={k.band}
      aria-label={k.band === "none" ? `${k.name}: no data` : `${k.name}: ${k.avgMs !== null ? text : "missed"}, ${b.label}`}
      role="img"
      style={style}
      className={`absolute top-0 box-border flex flex-col items-center justify-end border-t-0 pb-1.5 ${b.bg} ${b.text} ${black ? "z-10 rounded-b border-2 border-pn-ebony text-[10px] font-bold" : "rounded-b-md border-[0.5px] border-[#8c7b66]"}`}
    >
      <span className={black ? "" : "font-pnd text-lg font-bold leading-tight sm:text-xl"}>{k.name}</span>
      <span data-testid={`time-${k.name}`} className={black ? "" : "text-[10px] font-semibold sm:text-[11px]"}>
        {text}
      </span>
    </div>
  );
}

function NoteSpeedBoard({ data }: { data: NoteSpeed }) {
  const any = data.keys.some((k) => k.band !== "none");
  return (
    <section aria-label="Note speed" className="grid gap-4 rounded-xl border border-pn-line bg-pn-felt p-4 landscape:grid-cols-[minmax(0,2fr)_minmax(9rem,1fr)] md:grid-cols-[minmax(0,2fr)_minmax(9rem,1fr)]">
      <div className="space-y-2">
        <h3 id="note-speed-title" className="text-xs uppercase tracking-[0.12em] text-pn-brass">
          How fast you found each note
        </h3>
        <div className="rounded-lg bg-pn-ebony px-2.5 pb-2.5">
          <div className="h-[5px] bg-pn-crimson" />
          <div role="group" aria-labelledby="note-speed-title" className="relative h-[clamp(5.5rem,24vh,9.5rem)]">
            {data.keys.map((k) => (
              <SpeedKey key={k.name} k={k} />
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-3 text-sm">
        <ul aria-label="Legend" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-pn-ivory/80 md:flex-col">
          {(["fast", "ok", "slow", "none"] as const).map((band) => (
            <li key={band} className="flex items-center gap-2">
              <span aria-hidden className={`h-3 w-3 rounded-sm ${BAND[band].bg}`} />
              {BAND[band].label}
            </li>
          ))}
        </ul>
        <p data-testid="slow-line" className="leading-relaxed text-pn-ivory/90">
          {data.slow.length ? slowLine(data.slow) : any ? "No slow keys. Nothing to add to tomorrow's warm-up." : "No timing yet for these notes. Rounds from now on will show it."}
        </p>
      </div>
    </section>
  );
}

export function Results({ title = "Practice done", cards, noteSpeed, primary, secondary }: ResultsProps) {
  const single = cards.length <= 1;
  return (
    <section aria-label="Results" className={`w-full space-y-3 py-2 text-left ${single ? "max-w-xl" : "max-w-4xl"}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="font-pnd text-2xl font-semibold sm:text-3xl">{title}</h2>
        <span className="flex-1" />
        {secondary && <Action a={secondary} />}
        {primary && <Action a={primary} primary />}
      </div>
      <ol className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: single ? "minmax(0,1fr)" : "repeat(auto-fit, minmax(14rem, 1fr))" }}>
        {cards.map((c, i) => (c.kind === "drill" ? <DrillCard key={i} c={c} /> : c.kind === "rhythm" ? <RhythmCard key={i} c={c} /> : <SongCard key={i} c={c} />))}
      </ol>
      {noteSpeed && <NoteSpeedBoard data={noteSpeed} />}
    </section>
  );
}

export const songTag = (title: string, hands: keyof typeof HANDS) => `Song · ${title}, ${HANDS[hands]}`;
