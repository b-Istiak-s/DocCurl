import crypto from "node:crypto";

export const SESSION_COOKIE_NAME = "doccurl_session";
export const SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) {
    return cookies;
  }

  const parts = String(cookieHeader).split(";");
  for (const part of parts) {
    const eqIndex = part.indexOf("=");
    if (eqIndex < 0) {
      continue;
    }
    const key = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

export function buildSessionSignature(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function createSessionToken(secret, now = Date.now()) {
  const issuedAt = now;
  const expiresAt = now + SESSION_TTL_MS;
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = `${issuedAt}.${expiresAt}.${nonce}`;
  const signature = buildSessionSignature(payload, secret);
  return `${payload}.${signature}`;
}

export function isSessionTokenValid(token, secret, now = Date.now()) {
  if (typeof token !== "string" || !token) {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const issuedAt = Number(parts[0]);
  const expiresAt = Number(parts[1]);
  const nonce = parts[2];
  const signature = parts[3];

  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt <= 0 ||
    expiresAt <= issuedAt ||
    !nonce ||
    !signature
  ) {
    return false;
  }

  if (expiresAt < now) {
    return false;
  }

  const payload = `${issuedAt}.${expiresAt}.${nonce}`;
  const expectedSignature = buildSessionSignature(payload, secret);
  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

export function buildSessionCookie(token, { secure = false } = {}) {
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie({ secure = false } = {}) {
  return `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
