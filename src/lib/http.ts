// JSON the browser may reuse for `maxAge` seconds without asking again, so a repeat request
// costs no function call or middleware run. `private` keeps it out of shared caches, since every
// route sits behind the login.
export const cachedJson = (data: unknown, maxAge: number) =>
  Response.json(data, { headers: { "Cache-Control": `private, max-age=${maxAge}` } });

export const HOUR = 60 * 60;
export const DAY = 24 * HOUR;
