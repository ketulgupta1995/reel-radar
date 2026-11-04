// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { makeEpub } from "@/test/epub";
import { EpubError, parseEpub } from "./epub";

const failure = (p: Promise<unknown>) => p.then(() => null, (e: EpubError) => e);

describe("parseEpub", () => {
  it("reads the title, author and chapters in reading order, split into sentences", async () => {
    const book = await parseEpub(await makeEpub());
    expect(book.title).toBe("The Station Clock");
    expect(book.author).toBe("A. Writer");
    expect(book.chapters.map((c) => c.title)).toEqual(["Chapter One", "Chapter Two"]);
    expect(book.chapters[0].sentences).toEqual(["Chapter One", "Mr. Rao kept the clock fast.", "Nobody argued."]);
    expect(book.chapters[1].sentences).toEqual(["Chapter Two", "The rain began at the far end.", "She closed her book."]);
  });

  it("skips scripts, styles and spine entries that point nowhere, and names untitled sections", async () => {
    const book = await parseEpub(await makeEpub({ chapters: [["", ["Plain text only."]]] }));
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0]).toEqual({ title: "Section 1", sentences: ["Plain text only."] });
  });

  it("falls back to placeholders when the metadata is missing", async () => {
    const book = await parseEpub(await makeEpub({ title: "", author: "" }));
    expect(book.title).toBe("Untitled");
    expect(book.author).toBe("Unknown author");
  });

  it("reads chapters that are not well-formed XML", async () => {
    const bytes = await makeEpub({ extra: { "OEBPS/text/ch0.xhtml": "<html><body><p>Loose markup<br>Still readable.</body>" } });
    const book = await parseEpub(bytes);
    expect(book.chapters[0].sentences.join(" ")).toContain("Still readable.");
  });

  it("accepts font obfuscation but rejects any other encryption as DRM", async () => {
    const fonts = `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></EncryptedData></encryption>`;
    expect((await parseEpub(await makeEpub({ encryption: fonts }))).chapters).toHaveLength(2);

    const drm = fonts.replace("http://www.idpf.org/2008/embedding", "http://www.w3.org/2001/04/xmlenc#aes128-cbc");
    expect(await failure(parseEpub(await makeEpub({ encryption: drm })))).toMatchObject({ code: "drm" });
    expect(await failure(parseEpub(await makeEpub({ rights: true })))).toMatchObject({ code: "drm" });
  });

  it("rejects files that are not EPUBs", async () => {
    expect(await failure(parseEpub(new TextEncoder().encode("just text")))).toMatchObject({ code: "invalid" });
    expect(await failure(parseEpub(await makeEpub({ noContainer: true })))).toMatchObject({ code: "invalid" });
    expect(await failure(parseEpub(await makeEpub({ chapters: [] })))).toMatchObject({ code: "invalid" });
  });
});
