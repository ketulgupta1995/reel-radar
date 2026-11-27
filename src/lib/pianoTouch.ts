// Evenness of touch (pure): how evenly hard the keys were struck, from the velocity (1-127) of each note-on, and how
// hard each finger plays on average. Beginners tend to strike with the thumb hard and fingers 4 and 5 weakly, so
// the per-finger means show it. Only keyboard notes count: on-screen keys always send the same velocity.
//
// evenness = 100 x (1 - spread / mean), the spread being the standard deviation; 100 = every note equally loud.
// A typical beginner run lands around 70-85.
export type TouchSample = { finger: number; velocity: number };
export type FingerTouch = { finger: number; mean: number; n: number };
export type TouchStats = { n: number; mean: number; spread: number; evenness: number; fingers: FingerTouch[]; weak: number | null; strong: number | null };

export const MIN_TOUCH_SAMPLES = 8; // fewer notes than this say nothing about evenness
export const FINGER_GAP = 0.15; // a finger counts as weak (or strong) when its mean is this far below (above) the overall mean

export function touchStats(samples: readonly TouchSample[]): TouchStats | null {
  const ok = samples.filter((s) => s.velocity > 0 && s.finger >= 1 && s.finger <= 5);
  if (ok.length < MIN_TOUCH_SAMPLES) return null;
  const vs = ok.map((s) => s.velocity);
  const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
  const spread = Math.sqrt(vs.reduce((a, v) => a + (v - mean) ** 2, 0) / vs.length);
  const fingers: FingerTouch[] = [];
  for (let f = 1; f <= 5; f++) {
    const xs = ok.filter((s) => s.finger === f).map((s) => s.velocity);
    if (xs.length) fingers.push({ finger: f, mean: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), n: xs.length });
  }
  const off = (sign: 1 | -1) =>
    fingers
      .filter((x) => x.n >= 2 && (sign * (x.mean - mean)) / mean >= FINGER_GAP)
      .sort((a, b) => sign * (b.mean - a.mean))[0]?.finger ?? null;
  return { n: ok.length, mean: Math.round(mean), spread: Math.round(spread), evenness: Math.max(0, Math.round(100 * (1 - spread / mean))), fingers, weak: off(-1), strong: off(1) };
}

const FINGER_NAME = ["", "thumb", "finger 2", "finger 3", "finger 4", "finger 5"];
// "Your thumb plays hardest and finger 5 softest." / "Your fingers are even." (one line under the bars)
export function touchLine(t: TouchStats): string {
  if (t.weak && t.strong) return `Your ${FINGER_NAME[t.strong]} plays hardest and ${FINGER_NAME[t.weak]} softest.`;
  if (t.weak) return `${FINGER_NAME[t.weak][0].toUpperCase()}${FINGER_NAME[t.weak].slice(1)} plays softer than the others.`;
  if (t.strong) return `${FINGER_NAME[t.strong][0].toUpperCase()}${FINGER_NAME[t.strong].slice(1)} plays harder than the others.`;
  return "Your fingers play about equally hard.";
}
