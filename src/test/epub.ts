import JSZip from "jszip";

// Builds a small fake EPUB for tests. `chapters` are [title, paragraphs] pairs, one XHTML file each.
type Options = {
  title?: string;
  author?: string;
  chapters?: [string, string[]][];
  encryption?: string; // contents of META-INF/encryption.xml
  rights?: boolean; // adds META-INF/rights.xml
  noContainer?: boolean;
  extra?: Record<string, string>;
};

const DEFAULT_CHAPTERS: [string, string[]][] = [
  ["Chapter One", ["Mr. Rao kept the clock fast. Nobody argued."]],
  ["Chapter Two", ["The rain began at the far end.", "She closed her book."]],
];

export async function makeEpub(options: Options = {}): Promise<Uint8Array> {
  const { title = "The Station Clock", author = "A. Writer", chapters = DEFAULT_CHAPTERS } = options;
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  if (!options.noContainer) {
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    );
  }
  if (options.encryption) zip.file("META-INF/encryption.xml", options.encryption);
  if (options.rights) zip.file("META-INF/rights.xml", "<rights/>");

  const items = chapters.map((_, i) => `<item id="c${i}" href="text/ch${i}.xhtml" media-type="application/xhtml+xml"/>`).join("");
  const refs = chapters.map((_, i) => `<itemref idref="c${i}"/>`).join("");
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator></metadata><manifest>${items}<item id="css" href="style.css" media-type="text/css"/></manifest><spine>${refs}<itemref idref="missing"/></spine></package>`
  );
  chapters.forEach(([heading, paragraphs], i) => {
    const body = (heading ? `<h2>${heading}</h2>` : "") + paragraphs.map((p) => `<p>${p}</p>`).join("");
    zip.file(
      `OEBPS/text/ch${i}.xhtml`,
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><style>p{}</style></head><body>${body}<script>var a = 1.</script></body></html>`
    );
  });
  for (const [name, content] of Object.entries(options.extra ?? {})) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array" });
}

export async function epubFile(options?: Options, name = "book.epub"): Promise<File> {
  return new File([(await makeEpub(options)) as BlobPart], name, { type: "application/epub+zip" });
}
