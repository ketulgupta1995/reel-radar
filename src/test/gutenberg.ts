// A fake Project Gutenberg OPDS search feed, in the shape the real one has. Entries without a book
// number (like the "Subjects" grouping the real feed includes) are written as [null, title, content].
export const opdsFeed = (entries: [number | null, string, string][]) =>
  `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>x</id><title>Books: x</title>${entries
    .map(
      ([n, title, content]) =>
        `<entry><id>${n ? `https://www.gutenberg.org/ebooks/${n}.opds` : "https://www.gutenberg.org/ebooks/subjects/search.opds/?query=x"}</id><title>${title}</title><content type="text">${content}</content></entry>`
    )
    .join("")}</feed>`;
