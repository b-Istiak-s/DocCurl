import crypto from "node:crypto";

export function hashPassword(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest();
}

export function isPasswordValid(inputPassword, expectedPassword) {
  const inputHash = hashPassword(inputPassword);
  const expectedHash = hashPassword(expectedPassword);
  return crypto.timingSafeEqual(inputHash, expectedHash);
}
