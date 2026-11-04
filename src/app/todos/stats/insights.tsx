"use client";

import { useMemo } from "react";
import {
  MIN_PATTERN_DAYS,
  MIN_PATTERN_GAP,
  SLEEP_TARGET,
  computeLogTrends,
  computePatterns,
  computeTimeFit,
  FIT_TOLERANCE,
  MIN_FIT_TASKS,
  type Pattern,
  type TimeFit,
  type Trend,
  type TrendPoint,
} from "@/lib/plannerInsights";
import { tagColor, tagLabel } from "@/lib/plannerSettings";
import { WATER_GOAL, shiftDate, type DayLog, type TagId, type Todo } from "@/lib/todos";
import { fmtDuration, formatShortDate } from "../planner";
import { Card, TableToggle, Tip } from "./parts";

const NO_TAG_COLOR = "rgba(255,255,255,0.35)";

const litres = (ml: number) => `${(ml / 1000).toFixed(1)} L`;
const sleepText = (h: number) => `${h.toFixed(1)} h`;
const kg = (v: number) => `${v.toFixed(1)} kg`;
const rangeLabel = (p: TrendPoint) => (p.start === p.end ? formatShortDate(p.start) : `${formatShortDate(p.start)} – ${formatShortDate(p.end)}`);
const signed = (v: number, text: (abs: number) => string) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${text(Math.abs(v))}`;

type Days = Record<string, Todo[]>;

export function DayLogInsights({ days, logs, from, today, compare }: { days: Days; logs: Record<string, DayLog>; from: string; today: string; compare: boolean }) {
  const trends = useMemo(() => computeLogTrends(logs, from, today, compare), [logs, from, today, compare]);
  const patterns = useMemo(() => computePatterns(days, logs, from, shiftDate(today, -1)), [days, logs, from, today]);
  if (!trends.sleep.points.concat(trends.water.points, trends.weight.points).some((p) => p.value !== null)) return null;

  const change = (t: Trend, text: (abs: number) => string) => {
    if (t.previous === null || t.average === null) return "";
    const gap = t.average - t.previous;
    return text(Math.abs(gap)) === text(0) ? "About the same as the period before" : `${signed(gap, text)} vs. the period before`;
  };
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <BarTrend
          title="Sleep"
          trend={trends.sleep}
          format={sleepText}
          target={SLEEP_TARGET}
          targetLabel={`${SLEEP_TARGET} h`}
          sub={change(trends.sleep, sleepText) || "Hours slept the night before"}
          empty="Log when you went to sleep and woke up to see this."
        />
        <BarTrend
          title="Water"
          trend={trends.water}
          format={litres}
          target={WATER_GOAL}
          targetLabel={`${litres(WATER_GOAL)} goal`}
          sub={change(trends.water, litres) || "Per day, leaving out today"}
          empty="Log your water to see this."
        />
        <WeightTrend trend={trends.weight} change={trends.weightChange} />
      </div>
      <Patterns patterns={patterns} />
    </div>
  );
}

function Headline({ value, note }: { value: string; note?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {note && <span className="shrink-0 text-[11px] text-white/50">{note}</span>}
    </div>
  );
}

function BarTrend({ title, trend, format, target, targetLabel, sub, empty }: { title: string; trend: Trend; format: (v: number) => string; target: number; targetLabel: string; sub: string; empty: string }) {
  const max = Math.max(target * 1.25, ...trend.points.map((p) => p.value ?? 0));
  return (
    <Card title={title} sub={sub}>
      {trend.average === null && trend.points.every((p) => p.value === null) ? (
        <p className="text-sm text-white/50">{empty}</p>
      ) : (
        <>
          <Headline value={trend.average === null ? "–" : `${format(trend.average)} avg`} note={`┄ ${targetLabel}`} />
          <div className="relative h-28">
            <div className="pointer-events-none absolute inset-x-0 z-[1] border-t border-dashed border-white/60" style={{ bottom: `${(target / max) * 100}%` }} />
            <div className="flex h-full items-end gap-0.5">
              {trend.points.map((p) => (
                <div
                  key={p.start}
                  tabIndex={0}
                  className="group relative flex h-full min-w-0 flex-1 items-end outline-none"
                  aria-label={`${rangeLabel(p)}: ${p.value === null ? "not logged" : format(p.value)}`}
                >
                  <Tip>
                    <span className="block text-white/50">{rangeLabel(p)}</span>
                    <span className="font-semibold text-white">{p.value === null ? "Not logged" : format(p.value)}</span>
                  </Tip>
                  {p.value !== null && <div className="w-full rounded-t bg-gold" style={{ height: `${Math.max((p.value / max) * 100, 2)}%` }} />}
                </div>
              ))}
            </div>
          </div>
          <TableToggle head={["Date", title]} rows={trend.points.filter((p) => p.value !== null).map((p) => [rangeLabel(p), format(p.value!)])} />
        </>
      )}
    </Card>
  );
}

// Weight is judged by its slope, so it's a line on a scale fitted to its own range, not from zero.
function WeightTrend({ trend, change }: { trend: Trend; change: number | null }) {
  const known = trend.points.filter((p) => p.value !== null);
  const values = known.map((p) => p.value!);
  const low = Math.min(...values) - 0.5;
  const high = Math.max(...values) + 0.5;
  const count = trend.points.length;
  const x = (i: number) => ((i + 0.5) / count) * 100;
  const y = (v: number) => 100 - ((v - low) / (high - low)) * 100;
  const line = trend.points.flatMap((p, i) => (p.value === null ? [] : [`${x(i)},${y(p.value)}`])).join(" ");
  return (
    <Card title="Weight" sub={change === null ? "Your logged weight" : `${signed(change, kg)} over this period`}>
      {!known.length ? (
        <p className="text-sm text-white/50">Log your weight to see this.</p>
      ) : (
        <>
          <Headline value={`${kg(values[values.length - 1])} latest`} />
          <div className="relative h-28">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
              <polyline points={line} fill="none" stroke="#f6c453" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="absolute inset-0 flex">
              {trend.points.map((p, i) => (
                <div
                  key={p.start}
                  tabIndex={p.value === null ? undefined : 0}
                  className="group relative min-w-0 flex-1 outline-none"
                  aria-label={p.value === null ? undefined : `${rangeLabel(p)}: ${kg(p.value)}`}
                >
                  {p.value !== null && (
                    <>
                      <Tip>
                        <span className="block text-white/50">{rangeLabel(p)}</span>
                        <span className="font-semibold text-white">{kg(p.value)}</span>
                      </Tip>
                      <span
                        className="absolute left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-gold box-content opacity-0 group-hover:opacity-100 group-focus:opacity-100"
                        style={{ top: `${y(p.value)}%`, opacity: i === trend.points.lastIndexOf(known[known.length - 1]) ? 1 : undefined }}
                      />
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
          <TableToggle head={["Date", "Weight"]} rows={known.map((p) => [rangeLabel(p), kg(p.value!)])} />
        </>
      )}
    </Card>
  );
}

const PATTERN_TEXT: Record<Pattern["id"], { met: string; title: string }> = {
  sleep: { title: `After ${SLEEP_TARGET}+ hours of sleep`, met: `after ${SLEEP_TARGET}+ hours of sleep` },
  water: { title: `Reaching your ${litres(WATER_GOAL)} water goal`, met: `on days you reached your ${litres(WATER_GOAL)} water goal` },
};

function Patterns({ patterns }: { patterns: Pattern[] }) {
  return (
    <Card title="Patterns in your days" sub="How much of your tasks you finish, set against your day log. A pattern, not proof of a cause.">
      <ul className="grid gap-3 md:grid-cols-2">
        {patterns.map((p) => {
          const text = PATTERN_TEXT[p.id];
          return (
            <li key={p.id} className="rounded-xl border border-white/10 p-3 text-sm">
              <div className="font-medium">{text.title}</div>
              {!p.enough ? (
                <p className="mt-1 text-xs text-white/55">
                  Needs at least {MIN_PATTERN_DAYS} days each way, with tasks and a log entry. So far: {p.met.days} and {p.missed.days}.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-white/80">
                    {Math.abs(p.gap) < MIN_PATTERN_GAP
                      ? "No clear difference so far."
                      : `You finish ${p.gap > 0 ? "more" : "less"} of your tasks ${text.met}: ${p.met.rate}% vs. ${p.missed.rate}%.`}
                  </p>
                  <p className="mt-1 text-xs tabular-nums text-white/55">
                    {p.met.days} days that did, {p.missed.days} that didn't
                  </p>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const tagName = (tag: TagId | null) => (tag ? `${tagLabel(tag)} tasks` : "Untagged tasks");

function fitHeadline(f: TimeFit): string {
  if (Math.abs(f.overBy) < FIT_TOLERANCE) return `${tagName(f.tag)} run about as planned`;
  return `${tagName(f.tag)} run ${Math.abs(f.overBy)}% ${f.overBy > 0 ? "over" : "under"}`;
}

export function TimeFitCard({ days, from, today }: { days: Days; from: string; today: string }) {
  const fits = useMemo(() => computeTimeFit(days, from, today), [days, from, today]);
  const max = Math.max(...fits.flatMap((f) => [f.planned, f.actual]), 1);
  return (
    <Card title="Planned vs. actual time" sub="Finished time blocks with focus-timer time. Sessions under ¼ or over 4× the plan are left out.">
      {!fits.length ? (
        <p className="text-sm text-white/50">Finish {MIN_FIT_TASKS} time blocks with the same tag using the focus timer to see how your estimates hold up.</p>
      ) : (
        <>
          <div className="mb-3 flex gap-4 text-xs text-white/60">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm border border-white/40 bg-white/10" /> Planned
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-gold" /> Actual
            </span>
          </div>
          <ul className="space-y-4">
            {fits.map((f) => (
              <li key={f.tag ?? "none"} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="h-2 w-2 shrink-0 self-center rounded-full" style={{ background: f.tag ? tagColor(f.tag) : NO_TAG_COLOR }} />
                  <span className="font-medium">{fitHeadline(f)}</span>
                  <span className="text-xs text-white/50">
                    {f.tasks} tasks
                    {Math.abs(f.overBy) >= FIT_TOLERANCE && f.suggested !== f.typical ? ` · plan about ${fmtDuration(f.suggested)} instead of ${fmtDuration(f.typical)}` : ""}
                  </span>
                </div>
                <div className="mt-1.5 space-y-0.5">
                  <div className="h-2 rounded-r border border-white/40 bg-white/10" style={{ width: `${(f.planned / max) * 100}%` }} aria-label={`Planned ${fmtDuration(f.planned)}`} />
                  <div className="h-2 rounded-r bg-gold" style={{ width: `${(f.actual / max) * 100}%` }} aria-label={`Actual ${fmtDuration(f.actual)}`} />
                </div>
              </li>
            ))}
          </ul>
          <TableToggle
            head={["Tag", "Tasks", "Planned", "Actual", "Difference"]}
            rows={fits.map((f) => [f.tag ? tagLabel(f.tag) : "No tag", f.tasks, fmtDuration(f.planned), fmtDuration(f.actual), `${f.overBy > 0 ? "+" : ""}${f.overBy}%`])}
          />
        </>
      )}
    </Card>
  );
}
