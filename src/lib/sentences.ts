// Splits text into sentences for reading aloud (pure; no "use client"). Validated in the Android speech
// prototype: titles ("Mr."), initials ("J. R. R.") and lowercase continuations stay inside their sentence.

const ABBREVIATIONS = /(?:^|[\s("'“‘])(?:Mr|Mrs|Ms|Dr|Prof|St|Sr|Jr|Capt|Col|Gen|Rev|Hon|Lt|Sgt|Mt|vs|etc|e\.g|i\.e|No)\.$/;
const END = /[.!?…]+["'”’)\]]*(?=\s+|$)/g;

export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const m of text.matchAll(END)) {
    const stop = m.index + m[0].length;
    const chunk = text.slice(start, stop);
    const after = text.slice(stop).trimStart();
    if (ABBREVIATIONS.test(chunk) || /(?:^|\s)[A-Z]\.$/.test(chunk)) continue;
    if (after && /^[a-z]/.test(after)) continue;
    if (chunk.trim()) out.push(chunk.trim());
    start = stop;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}
