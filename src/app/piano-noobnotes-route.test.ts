import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./api/piano/noobnotes/route";

const get = (url: string) => GET(new Request(`http://x/api/piano/noobnotes?url=${encodeURIComponent(url)}`));
const stub = (...res: (Response | Error)[]) => {
  const f = vi.fn();
  for (const r of res) f.mockImplementationOnce(() => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r)));
  vi.stubGlobal("fetch", f);
  return f;
};
const redirect = (to: string) => new Response(null, { status: 301, headers: { location: to } });
const URL_OK = "https://noobnotes.net/a-song/";

afterEach(() => vi.unstubAllGlobals());

describe("GET /api/piano/noobnotes", () => {
  it("refuses other sites without fetching", async () => {
    const f = stub();
    expect((await get("https://example.com/x")).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
  it("returns the notes, following a redirect within the site", async () => {
    stub(redirect("/b/"), new Response('<div class="post-content"><p>C D<br />words</p></div>'));
    expect(await (await get(URL_OK)).json()).toEqual({ title: "NoobNotes song", lines: ["C D"] });
  });
  it("never follows a redirect off the site", async () => {
    const f = stub(redirect("http://127.0.0.1/"));
    expect((await get(URL_OK)).status).toBe(502);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("reports failures", async () => {
    for (const [res, status] of [
      [new Error("down"), 502],
      [new Response("", { status: 404 }), 404],
      [new Response("", { status: 403 }), 502],
      [new Response("<p>nothing</p>"), 422],
    ] as const) {
      stub(res);
      expect((await get(URL_OK)).status).toBe(status);
    }
  });
});
