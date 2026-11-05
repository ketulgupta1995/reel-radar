import { describe, expect, it } from "vitest";
import { PdfLine, joinPages, paragraphsOfPage, stripPageFurniture } from "./pdfText";

// A page of lines from the top down, 16 points apart unless a line says where it sits.
const page = (...lines: (string | [string, number])[]): PdfLine[] =>
  lines.map((l, i) => (typeof l === "string" ? { text: l, y: 700 - i * 16, height: 12 } : { text: l[0], y: l[1], height: 12 }));
const texts = (p: PdfLine[]) => p.map((l) => l.text);

describe("stripPageFurniture", () => {
  const names = ["Alpha", "Bravo", "Charlie", "Delta"];
  const body = (n: number) => [`${names[n - 1]} walked in.`, `${names[n - 1]} sat down.`, `${names[n - 1]} left.`];

  it("drops a running header and footer that repeat on most pages, whatever the page number in them", () => {
    const pages = [1, 2, 3, 4].map((n) => page(["The Station Clock", 760], ...body(n), [`Chapter One — ${n + 10}`, 30]));
    const out = stripPageFurniture(pages);
    expect(texts(out[0])).toEqual(body(1));
    expect(texts(out[3])).toEqual(body(4));
  });

  it("drops bare page numbers, even in a short document", () => {
    const out = stripPageFurniture([page("Hello there.", ["12", 30]), page("Another page.", ["Page 13", 30]), page(["- 14 -", 760], "Third.")]);
    expect(out.map(texts)).toEqual([["Hello there."], ["Another page."], ["Third."]]);
  });

  it("keeps a line that repeats in a document of fewer than three pages", () => {
    const out = stripPageFurniture([page("Meanwhile, nothing changed.", "One."), page("Meanwhile, nothing changed.", "Two.")]);
    expect(texts(out[0])).toEqual(["Meanwhile, nothing changed.", "One."]);
  });

  it("keeps a line that repeats in the middle of the pages, not at their top or bottom", () => {
    const pages = [1, 2, 3, 4].map((n) => page(`Top ${n} a.`, `Top ${n} b.`, "* * *", `Mid ${n} a.`, `Mid ${n} b.`, `Foot ${n} a.`, `Foot ${n} b.`));
    expect(stripPageFurniture(pages).every((p) => texts(p).includes("* * *"))).toBe(true);
  });

  it("keeps a line that repeats on fewer than half the pages", () => {
    const pages = [page("Title", ...[1].map((n) => `A ${n}.`)), page("Title", "B.", "C."), page("D.", "E.", "F.", "G.", "H."), page("I.", "J.", "K.", "L.", "M."), page("N.", "O.", "P.", "Q.", "R.")];
    expect(texts(stripPageFurniture(pages)[0])[0]).toBe("Title");
  });

  it("keeps a long repeated line, which is text and not a header", () => {
    const long = "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness.";
    const pages = [1, 2, 3, 4].map((n) => page(long, `Body ${n} a.`, `Body ${n} b.`, `Body ${n} c.`, `Body ${n} d.`, long));
    expect(texts(stripPageFurniture(pages)[0])).toContain(long);
  });

  it("does not take the lines of very short pages for furniture", () => {
    const pages = [1, 2, 3, 4].map((n) => page(`Verse ${n}.`, "Amen.", "Selah."));
    expect(stripPageFurniture(pages).map(texts)).toEqual(pages.map(texts));
  });

  it("leaves a page with no lines alone", () => {
    expect(stripPageFurniture([[], page("Hi.")])).toEqual([[], page("Hi.")]);
  });
});

describe("paragraphsOfPage", () => {
  it("joins the lines of a paragraph with a space", () => {
    expect(paragraphsOfPage(page("The long walk", "home was tiring.", "Everyone agreed."))).toEqual(["The long walk home was tiring. Everyone agreed."]);
  });

  it("starts a new paragraph at a larger gap", () => {
    expect(paragraphsOfPage(page(["Chapter One", 700], ["It was dark.", 660], ["Very dark.", 644]))).toEqual(["Chapter One", "It was dark. Very dark."]);
  });

  it("rejoins a word hyphenated across a line break when the next line goes on in lower case", () => {
    expect(paragraphsOfPage(page("The conver-", "sation went on."))).toEqual(["The conversation went on."]);
    expect(paragraphsOfPage(page("A soft\u00AD", "hyphen."))).toEqual(["A softhyphen."]);
  });

  it("keeps the hyphen, and closes the gap, when the next line starts with a capital; a hyphen after a digit is left alone", () => {
    expect(paragraphsOfPage(page("The Anglo-", "Saxon king."))).toEqual(["The Anglo-Saxon king."]);
    expect(paragraphsOfPage(page("Route 66-", "1 and on."))).toEqual(["Route 66- 1 and on."]);
  });

  it("leaves a hyphen inside a line, and a dash with spaces around it, alone", () => {
    expect(paragraphsOfPage(page("A well-known story - told twice -", "again."))).toEqual(["A well-known story - told twice - again."]);
  });

  it("starts a new paragraph when the next line sits higher than the last", () => {
    expect(paragraphsOfPage(page(["End of left column.", 100], ["Start of right column.", 700]))).toEqual(["End of left column.", "Start of right column."]);
  });

  it("gives nothing for a page without lines", () => {
    expect(paragraphsOfPage([])).toEqual([]);
  });
});

describe("joinPages", () => {
  it("joins a paragraph that is still open at the end of a page with the next page's first", () => {
    expect(joinPages([["Intro.", "The long walk home was"], ["tiring for everyone.", "Next."]])).toEqual(["Intro.", "The long walk home was tiring for everyone.", "Next."]);
  });

  it("does not join a paragraph that ended, however it ended", () => {
    for (const end of ["done.", "done!", "done?", 'done."', "done”", "done)"]) {
      expect(joinPages([[`It was ${end}`], ["Next page."]])).toEqual([`It was ${end}`, "Next page."]);
    }
  });

  it("rejoins a word hyphenated across a page break", () => {
    expect(joinPages([["The conver-"], ["sation went on."]])).toEqual(["The conversation went on."]);
    expect(joinPages([["The Anglo-"], ["Saxon king."]])).toEqual(["The Anglo-Saxon king."]);
  });

  it("skips pages without text", () => {
    expect(joinPages([["One."], [], ["Two"], [], ["three."]])).toEqual(["One.", "Two three."]);
  });
});
