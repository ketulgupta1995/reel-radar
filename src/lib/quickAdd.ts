import { activeTags } from "./plannerSettings";
import { weekOf, type RepeatRule } from "./reminders";
import { getTodayDate, shiftDate, weekday, type Priority, type TagId } from "./todos";

// Shorthand typed into the add-task box, e.g. "Gym 6:30pm 45m #health !high daily".
// Recognised words are taken out of the title; anything else stays as typed.
export type QuickAdd = {
  text: string;
  priority?: Priority;
  tag?: TagId;
  start?: number; // minutes since midnight
  duration?: number; // minutes
  daily?: boolean; // plain "daily"
  repeat?: RepeatRule; // any other repeat
  date?: string; // YYYY-MM-DD, from "tomorrow", "fri", "15 nov"
};

const PRIORITIES: Record<string, Priority> = {
  "!high": "high", "!h": "high", "!1": "high", "!!": "high", "!urgent": "high",
  "!medium": "medium", "!med": "medium", "!m": "medium", "!2": "medium",
  "!low": "low", "!l": "low", "!3": "low",
};

// A tag is typed as #name, with spaces left out: "Deep work" is #deepwork.
const tagWords = () => new Map<string, TagId>(activeTags().flatMap((t) => [[t.id, t.id], [t.label.toLowerCase().replace(/\s+/g, ""), t.id]] as [string, TagId][]));

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const FULL_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
// These are also words ("Sun cream", "Sat exam"), so alone they only count at the end of the title.
const WORDLIKE_DAYS = new Set(["sun", "sat", "mon"]);

const isDay = (w: string | undefined): w is string => w !== undefined && Object.hasOwn(DAYS, w);

const monthOfWord = (w: string) => {
  const i = MONTHS.indexOf(w);
  return i >= 0 ? i : FULL_MONTHS.indexOf(w);
};
const dayNumber = (w: string | undefined) => {
  const m = w ? /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(w) : null;
  return m && Number(m[1]) >= 1 && Number(m[1]) <= 31 ? Number(m[1]) : null;
};

// The next time this weekday comes round, after today.
function nextWeekday(day: number, today: string): string {
  return shiftDate(today, (day - weekday(today) + 7) % 7 || 7);
}

// This day and month, or next year's if it has passed. Null for dates that don't exist (31 feb).
function dayInMonth(day: number, month: number, today: string): string | null {
  const year = Number(today.slice(0, 4));
  const iso = (y: number) => `${y}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (new Date(year, month, day).getMonth() !== month) return null;
  return iso(year) >= today ? iso(year) : iso(year + 1);
}

// A date starting at words[i], and how many words it took.
function parseDate(words: string[], i: number, today: string): { date: string; used: number } | null {
  const w = words[i];
  const next = words[i + 1];
  if (w === "today") return { date: today, used: 1 };
  if (w === "tomorrow" || w === "tmrw" || w === "tmr") return { date: shiftDate(today, 1), used: 1 };
  if (w === "next" && isDay(next)) return { date: weekOf(shiftDate(today, 7))[(DAYS[next] + 6) % 7], used: 2 };
  if (w === "on" && isDay(next)) return { date: nextWeekday(DAYS[next], today), used: 2 };
  if (isDay(w) && !WORDLIKE_DAYS.has(w)) return { date: nextWeekday(DAYS[w], today), used: 1 };
  const day = dayNumber(w);
  if (day !== null && next !== undefined && monthOfWord(next) >= 0) {
    const date = dayInMonth(day, monthOfWord(next), today);
    return date ? { date, used: 2 } : null;
  }
  const after = dayNumber(next);
  if (monthOfWord(w) >= 0 && after !== null) {
    const date = dayInMonth(after, monthOfWord(w), today);
    return date ? { date, used: 2 } : null;
  }
  return null;
}

// A repeat starting at words[i], and how many words it took. A monthly or weekly repeat with no day
// named is marked 0 or empty, to be filled in from the task's date.
function parseRepeat(words: string[], i: number): { repeat: RepeatRule; used: number } | null {
  const [w, a, b] = words.slice(i, i + 3);
  // "on the 1st", "on 1st" (ending monthly / every month), or the whole of "on the 1st"
  const onDay = (at: number): { day: number; used: number } | null => {
    if (words[at] !== "on") return null;
    const the = words[at + 1] === "the" ? 1 : 0;
    const day = dayNumber(words[at + 1 + the]);
    return day === null ? null : { day, used: 2 + the };
  };
  if (w === "on" && a === "the" && b && /(st|nd|rd|th)$/.test(b) && dayNumber(b) !== null) return { repeat: { monthDay: dayNumber(b)! }, used: 3 };
  if (w === "monthly") {
    const on = onDay(i + 1);
    return { repeat: { monthDay: on?.day ?? 0 }, used: 1 + (on?.used ?? 0) };
  }
  if (w === "every" && a === "month") {
    const on = onDay(i + 2);
    return { repeat: { monthDay: on?.day ?? 0 }, used: 2 + (on?.used ?? 0) };
  }
  if (w === "weekly") return { repeat: { days: [] }, used: 1 };
  if (w === "every" && a === "other" && b === "day") return { repeat: { every: 2 }, used: 3 };
  if (w === "every" && a && /^\d+$/.test(a) && (b === "days" || b === "day" || b === "weeks" || b === "week")) {
    const n = Number(a) * (b.startsWith("week") ? 7 : 1);
    return n >= 2 && n <= 365 ? { repeat: { every: n }, used: 3 } : null;
  }
  if (w === "every" && isDay(a)) {
    const days = [DAYS[a]];
    let used = 2;
    while (isDay(words[i + used])) days.push(DAYS[words[i + used++]]);
    return { repeat: { days }, used };
  }
  // 3x week, 3x/week, 3x a week, 3 times a week, 3 times per week, twice a week
  const perWeek = /^(\d)x\/?(week|wk)?$/.exec(w);
  const count = perWeek ? Number(perWeek[1]) : w === "twice" ? 2 : /^\d$/.test(w) && (a === "times" || a === "x") ? Number(w) : 0;
  if (count >= 1 && count <= 6) {
    if (perWeek?.[2]) return { repeat: { timesPerWeek: count }, used: 1 };
    const from = perWeek || w === "twice" ? 1 : 2;
    const [x, y] = words.slice(i + from, i + from + 2);
    if (x === "week" || x === "wk") return { repeat: { timesPerWeek: count }, used: from + 1 };
    if ((x === "a" || x === "per") && (y === "week" || y === "wk")) return { repeat: { timesPerWeek: count }, used: from + 2 };
  }
  return null;
}

// 6pm, 6:30pm, 6.30 pm, 18:00, 7am; "at 9" and "@9" read 1–6 as afternoon, like people mean them.
function parseTime(word: string, afterAt: boolean): number | null {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/.exec(word);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ampm = m[3];
  if (min > 59) return null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === "pm" ? 12 : 0);
  } else if (m[2] !== undefined) {
    if (h > 23) return null;
  } else if (afterAt) {
    if (h < 1 || h > 12) return null;
    if (h <= 6) h += 12;
  } else {
    return null; // a bare number is part of the title ("Read 20 pages")
  }
  return h * 60 + min;
}

// 30m, 45min, 1h, 1.5h, 2hrs, 1h30, 1h30m
function parseDuration(word: string): number | null {
  const m = /^(?:(\d+(?:\.\d+)?)(?:h|hr|hrs|hour|hours))?(?:(\d+)(?:m|min|mins)?)?$/.exec(word);
  if (!m || (!m[1] && !m[2])) return null;
  if (!m[1] && !/[a-z]$/.test(word)) return null; // "45" alone isn't a length
  const mins = Math.round(Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0));
  return mins > 0 && mins <= 24 * 60 ? mins : null;
}

export function parseQuickAdd(input: string, today = getTodayDate()): QuickAdd {
  const out: QuickAdd = { text: "" };
  const kept: string[] = [];
  const words = input.trim().split(/\s+/).filter(Boolean);
  const lower = words.map((w) => w.toLowerCase());
  const tags = tagWords();
  let wordlike: { at: number; day: number } | null = null; // a "sun" or "sat" kept in the title, for now
  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    const w = raw.toLowerCase();
    const repeat = !out.repeat && !out.daily ? parseRepeat(lower, i) : null;
    const date = out.date === undefined ? parseDate(lower, i, today) : null;
    if (repeat) {
      out.repeat = repeat.repeat;
      i += repeat.used - 1;
      continue;
    }
    if (date) {
      out.date = date.date;
      i += date.used - 1;
      continue;
    }
    if (out.date === undefined && WORDLIKE_DAYS.has(w) && lower[i - 1] !== "the") wordlike = { at: kept.length, day: DAYS[w] };
    // "6 pm" written with a space
    const joined = i + 1 < words.length && /^(am|pm)$/i.test(words[i + 1]) ? w + words[i + 1].toLowerCase() : null;

    if (out.priority === undefined && Object.hasOwn(PRIORITIES, w)) {
      out.priority = PRIORITIES[w];
    } else if (out.tag === undefined && w.startsWith("#") && tags.has(w.slice(1))) {
      out.tag = tags.get(w.slice(1));
    } else if (!out.daily && (w === "daily" || w === "everyday" || (w === "every" && words[i + 1]?.toLowerCase() === "day"))) {
      out.daily = true;
      if (w === "every") i++;
    } else if (out.start === undefined && (w === "at" || w.startsWith("@"))) {
      const next = w === "at" ? words[i + 1]?.toLowerCase() : w.slice(1);
      const withAmPm = w === "at" && i + 2 < words.length && /^(am|pm)$/i.test(words[i + 2]) ? next + words[i + 2].toLowerCase() : null;
      const t = next !== undefined ? parseTime(withAmPm ?? next, true) : null;
      if (t === null) kept.push(raw);
      else {
        out.start = t;
        if (w === "at") i += withAmPm ? 2 : 1;
      }
    } else if (out.start === undefined && joined && parseTime(joined, false) !== null) {
      out.start = parseTime(joined, false)!;
      i++;
    } else if (out.start === undefined && parseTime(w, false) !== null) {
      out.start = parseTime(w, false)!;
    } else if (out.duration === undefined && parseDuration(w) !== null) {
      out.duration = parseDuration(w)!;
    } else {
      kept.push(raw);
    }
  }
  if (wordlike && wordlike.at === kept.length - 1 && out.date === undefined) {
    kept.pop();
    out.date = nextWeekday(wordlike.day, today);
  }
  out.text = kept.join(" ");
  // "monthly" and "weekly" with no day named take it from the task's own date.
  if (out.repeat?.monthDay === 0) out.repeat = { monthDay: Number((out.date ?? today).slice(8)) };
  if (out.repeat?.days?.length === 0) out.repeat = { days: [weekday(out.date ?? today)] };
  return out;
}
