import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifyInitData, parseInitData } from "@/lib/auth";

const BOT_TOKEN = "12345:fake-bot-token-for-tests-1234567890";

function signInitData(params: Record<string, string>, token: string): string {
  const dataCheckString = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
}

describe("verifyInitData", () => {
  it("accepts a correctly signed payload", () => {
    const user = JSON.stringify({ id: 12345, first_name: "Maria" });
    const initData = signInitData(
      { user, auth_date: String(Math.floor(Date.now() / 1000)), query_id: "abc" },
      BOT_TOKEN,
    );
    expect(verifyInitData(initData, BOT_TOKEN).ok).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const user = JSON.stringify({ id: 12345, first_name: "Maria" });
    const initData = signInitData(
      { user, auth_date: String(Math.floor(Date.now() / 1000)) },
      BOT_TOKEN,
    );
    const tampered = initData.replace("Maria", "Admin");
    expect(verifyInitData(tampered, BOT_TOKEN).ok).toBe(false);
  });

  it("rejects payload older than the freshness window", () => {
    const user = JSON.stringify({ id: 12345 });
    const oldDate = Math.floor(Date.now() / 1000) - 60 * 60 * 25;
    const initData = signInitData({ user, auth_date: String(oldDate) }, BOT_TOKEN);
    expect(verifyInitData(initData, BOT_TOKEN, { maxAgeSeconds: 86400 }).ok).toBe(false);
  });

  it("parses user from a valid payload", () => {
    const user = JSON.stringify({ id: 99, first_name: "X", username: "xx" });
    const initData = signInitData(
      { user, auth_date: String(Math.floor(Date.now() / 1000)) },
      BOT_TOKEN,
    );
    const r = verifyInitData(initData, BOT_TOKEN);
    if (!r.ok) throw new Error("expected ok");
    const parsed = parseInitData(r.data);
    expect(parsed.user.id).toBe(99);
    expect(parsed.user.username).toBe("xx");
  });

  it("rejects when hash header missing", () => {
    expect(verifyInitData("user=%7B%7D&auth_date=1", BOT_TOKEN).ok).toBe(false);
  });
});
