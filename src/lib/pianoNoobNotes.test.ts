import { describe, expect, it } from "vitest";
import { buildNoobSong, noobNotes, noobUrl, parseNoobPage } from "./pianoNoobNotes";
import { applyRun } from "./pianoSongLadder";
import { decodeSong, encodeSong } from "./pianoSongImport";

const PAGE = `<h1 class="entry-title ">My Song &#8211; Someone <i class="x" style="display:none;"></i></h1>
<div class="post-content">
<p>&nbsp;</p>
<p>G   ^C - B   .A<br />
Some words here</p>
<p>F#-Bb ~<br />
A lyric line</p>
</div><p>A B C</p>`;

describe("noobUrl", () => {
  it("takes only noobnotes.net song pages", () => {
    expect(noobUrl(" noobnotes.net/a-song/ ")?.href).toBe("https://noobnotes.net/a-song/");
    expect(noobUrl("http://www.noobnotes.net/a-song/")?.protocol).toBe("https:");
    for (const bad of ["", "https://noobnotes.net/", "https://evil.com/noobnotes.net", "https://noobnotes.net.evil.com/x", "https://a@noobnotes.net/x", "https://noobnotes.net:81/x", "http://[bad"])
      expect(noobUrl(bad)).toBeUndefined();
  });
});

describe("NoobNotes pages", () => {
  it("keeps the title and the note lines, not the lyrics or anything after the post", () => {
    expect(parseNoobPage(PAGE)).toEqual({ title: "My Song – Someone", lines: ["G ^C - B .A", "F#-Bb ~"] });
    expect(parseNoobPage("<p>G A B</p>")).toBeUndefined();
    expect(parseNoobPage('<div class="post-content"><p>only words</p></div>')).toBeUndefined();
  });
  it("reads octaves and gives made-up timing", () => {
    expect(noobNotes(["G ^C - B .A", "F#"])).toEqual([
      { start: 0, dur: 1, pitch: 67 },
      { start: 1, dur: 0.5, pitch: 72 },
      { start: 1.5, dur: 0.5, pitch: 71 },
      { start: 2, dur: 2, pitch: 57 },
      { start: 4, dur: 2, pitch: 66 },
    ]);
  });
  it("builds a right-hand song that survives storage", () => {
    const song = buildNoobSong(["C D E"], "0123456789ab", " Tune ", 100)!;
    expect(decodeSong(encodeSong(song), song.id)).toEqual(song);
    expect(buildNoobSong([], "x", "t")).toBeUndefined();
  });
  it("sends a right-only song straight from right-hand wait to tempo, and lets it be mastered", () => {
    const song = buildNoobSong(["C D E"], "0123456789ab", "Tune", 90)!;
    const waited = applyRun(song, undefined, { mode: "wait", hands: "R", finished: true, misses: 0, steps: 3 }, 1);
    expect(waited.progress.step).toBe(3);
    expect(applyRun(song, waited.progress, { mode: "play", hands: "R", onTime: 1, tempo: 90 }, 2).mastered).toBe(true);
  });
});
