import { describe, it, expect } from "vitest";
import { generateKeyPair, exportJWK, importJWK, jwtVerify, type JWK } from "jose";
import { mintJwtWithKey, type SigningKey } from "@/lib/auth";

async function freshSigningKeyPair(): Promise<{ signingKey: SigningKey; publicJwk: JWK }> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const privJwk = await exportJWK(privateKey);
  const pubJwk = await exportJWK(publicKey);
  const kid = "test-kid";
  privJwk.kid = kid;
  privJwk.alg = "ES256";
  pubJwk.kid = kid;
  pubJwk.alg = "ES256";
  return {
    signingKey: { jwk: privJwk as JWK & { kid: string; alg: string } },
    publicJwk: pubJwk,
  };
}

describe("mintJwtWithKey", () => {
  it("mints an ES256 JWT verifiable by the public half", async () => {
    const { signingKey, publicJwk } = await freshSigningKeyPair();

    const jwt = await mintJwtWithKey(signingKey, 12345, "teacher");

    const pubKey = await importJWK(publicJwk, "ES256");
    const { payload, protectedHeader } = await jwtVerify(jwt, pubKey);

    expect(protectedHeader.alg).toBe("ES256");
    expect(protectedHeader.kid).toBe("test-kid");
    expect(protectedHeader.typ).toBe("JWT");
    expect(payload.sub).toBe("12345");
    expect(payload.role).toBe("authenticated");
    expect(payload.app_role).toBe("teacher");
    expect(typeof payload.exp).toBe("number");
    expect(typeof payload.iat).toBe("number");
  });

  it("rejects verification with a different key", async () => {
    const a = await freshSigningKeyPair();
    const b = await freshSigningKeyPair();

    const jwt = await mintJwtWithKey(a.signingKey, 99, "student");
    const wrongPubKey = await importJWK(b.publicJwk, "ES256");

    await expect(jwtVerify(jwt, wrongPubKey)).rejects.toThrow();
  });
});
