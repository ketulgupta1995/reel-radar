import { TAGS, type Priority, type TagId } from "./todos";

// Shorthand typed into the add-task box, e.g. "Gym 6:30pm 45m #health !high daily".
// Recognised words are taken out of the title; anything else stays as typed.
export type QuickAdd = {
  text: string;
  priority?: Priority;
  tag?: TagId;
  start?: number; // minutes since midnight
  duration?: number; // minutes
  daily?: boolean;
};

const PRIORITIES: Record<string, Priority> = {
  "!high": "high", "!h": "high", "!1": "high", "!!": "high", "!urgent": "high",
  "!medium": "medium", "!med": "medium", "!m": "medium", "!2": "medium",
  "!low": "low", "!l": "low", "!3": "low",
};

const TAG_BY_WORD = new Map<string, TagId>(
  TAGS.flatMap((t) => [[t.id, t.id], [t.label.toLowerCase(), t.id]] as [string, TagId][])
);

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

export function parseQuickAdd(input: string): QuickAdd {
  const out: QuickAdd = { text: "" };
  const kept: string[] = [];
  const words = input.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    const w = raw.toLowerCase();
    // "6 pm" written with a space
    const joined = i + 1 < words.length && /^(am|pm)$/i.test(words[i + 1]) ? w + words[i + 1].toLowerCase() : null;

    if (out.priority === undefined && PRIORITIES[w]) {
      out.priority = PRIORITIES[w];
    } else if (out.tag === undefined && w.startsWith("#") && TAG_BY_WORD.has(w.slice(1))) {
      out.tag = TAG_BY_WORD.get(w.slice(1));
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
  out.text = kept.join(" ");
  return out;
}
