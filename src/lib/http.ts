/**
 * Reads and JSON-parses a request body. Returns an empty object on parse failure
 * so caller-side `Body.safeParse(...)` can produce a clean 400, but logs the
 * malformed body at warn level so we don't lose visibility on integration bugs.
 */
export async function readJsonBody<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch (e) {
    const path = (() => {
      try {
        return new URL(req.url).pathname;
      } catch {
        return req.url;
      }
    })();
    console.warn("malformed JSON body", { path, reason: (e as Error).message });
    return {} as T;
  }
}
