// JSON the browser may reuse for `maxAge` seconds without asking again, so a repeat request
// costs no function call or proxy run. `private` keeps it out of shared caches, since every
// route sits behind the login.
export const cachedJson = (data: unknown, maxAge: number) =>
  Response.json(data, { headers: { "Cache-Control": `private, max-age=${maxAge}` } });

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

// As long as Next's data cache keeps the same TMDB answers (lib/tmdb.ts): asking sooner costs a
// function call and usually gets the same data back.
export const LIST_MAX_AGE = 6 * HOUR;
export const DETAIL_MAX_AGE = 7 * DAY;
