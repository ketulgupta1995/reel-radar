// A fake Standard Ebooks search page, in the markup the real site uses.
export const resultsPage = (books: [path: string, title: string, authors: string[]][]) =>
  `<html><body><main class="ebooks"><h1>Browse Ebooks</h1>${
    books.length
      ? `<ol class="ebooks-list grid">${books
          .map(
            ([path, title, authors]) =>
              `<li typeof="schema:Book" about="/ebooks/${path}"><p><a href="/ebooks/${path}" property="schema:url"><span property="schema:name">${title}</span></a></p>${authors
                .map((a) => `<p class="author" typeof="schema:Person"><a href="#"><span property="schema:name">${a}</span></a></p>`)
                .join("")}</li>`
          )
          .join("")}</ol>`
      : ""
  }</main></body></html>`;

export const textResponse = (body: string, ok = true) => ({ ok, status: ok ? 200 : 503, text: async () => body }) as Response;
export const bytesResponse = (bytes: Uint8Array, ok = true) =>
  ({ ok, status: ok ? 200 : 404, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }) as Response;
