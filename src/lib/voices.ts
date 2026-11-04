// Which speech voices to offer (pure; no "use client"). Android lists hundreds, one per English region.

export type VoiceInfo = { name: string; lang: string; voiceURI: string; localService: boolean };

export const RATES = [0.75, 1, 1.25, 1.5, 2];
export const MAX_VOICES = 12;

// "en_IN" and "en-IN" both appear in the wild.
export const langTag = (lang: string) => lang.replace("_", "-");
const isEnglish = (v: VoiceInfo) => /^en([-_]|$)/i.test(v.lang);
const regionOf = (lang: string) => langTag(lang).split("-")[1]?.toUpperCase() ?? "";

// English voices only, on-device ones first, then your own region, India, the US and the UK, then the
// rest by name. Cut to a short list, but a voice you chose earlier is always kept.
export function englishVoices<T extends VoiceInfo>(all: T[], userLang = "en-US", chosenURI?: string | null): T[] {
  const order = [regionOf(userLang), "IN", "US", "GB"];
  const rank = (v: T) => {
    const i = order.indexOf(regionOf(v.lang));
    return i < 0 ? order.length : i;
  };
  const seen = new Set<string>();
  const list = all
    .filter(isEnglish)
    .filter((v) => !seen.has(v.voiceURI) && !!seen.add(v.voiceURI))
    .sort((a, b) => Number(!a.localService) - Number(!b.localService) || rank(a) - rank(b) || a.name.localeCompare(b.name));
  const top = list.slice(0, MAX_VOICES);
  const chosen = list.find((v) => v.voiceURI === chosenURI);
  return chosen && !top.includes(chosen) ? [chosen, ...top] : top;
}

export const voiceLabel = (v: VoiceInfo) => (v.localService ? v.name : `${v.name} (online)`);
