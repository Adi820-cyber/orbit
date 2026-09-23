import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from 'jose';

export const TEST_ISSUER = 'https://fixture-project.supabase.co/auth/v1';
export const TEST_AUDIENCE = 'authenticated';
const KID = 'fixture-key';

/** A local ES256 signer + JWKS so auth tests never call Supabase. */
export async function createTestIssuer() {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  const getKey = createLocalJWKSet({ keys: [{ ...jwk, kid: KID, alg: 'ES256', use: 'sig' }] });

  async function sign(subject: string, overrides: JWTPayload = {}, key: CryptoKey = privateKey): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      iss: TEST_ISSUER,
      aud: TEST_AUDIENCE,
      sub: subject,
      role: 'authenticated',
      is_anonymous: false,
      iat: now,
      exp: now + 300,
      ...overrides,
    })
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .sign(key);
  }

  return { getKey, sign };
}

export async function signHs256(subject: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: TEST_ISSUER, aud: TEST_AUDIENCE, sub: subject, role: 'authenticated', exp: now + 300 })
    .setProtectedHeader({ alg: 'HS256', kid: KID })
    .sign(new TextEncoder().encode('fixture-shared-secret-not-a-real-secret'));
}

export function unsignedToken(subject: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'none', typ: 'JWT' });
  const payload = encode({ iss: TEST_ISSUER, aud: TEST_AUDIENCE, sub: subject, role: 'authenticated', exp: now + 300 });
  return `${header}.${payload}.${encode({})}`;
}
