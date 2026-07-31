import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

export function normalizeUsername(username: string) {
  return username.normalize("NFKC").trim().toLocaleLowerCase("pt-BR");
}

export function validateUsername(username: string) {
  const trimmed = username.trim();
  if (!trimmed) return "Informe o nome de usuário.";
  if (trimmed.length < 3 || trimmed.length > 32) {
    return "O nome de usuário deve ter entre 3 e 32 caracteres.";
  }
  if (!/^[\p{L}\p{N}._-]+$/u.test(trimmed)) {
    return "Use apenas letras, números, ponto, hífen ou sublinhado.";
  }
  return null;
}

export function validatePassword(password: string) {
  if (password.length < 8) return "A senha deve ter pelo menos 8 caracteres.";
  if (password.length > 128) return "A senha deve ter no máximo 128 caracteres.";
  return null;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await deriveKey(password, salt);
  return {
    passwordHash: hash.toString("base64"),
    passwordSalt: salt.toString("base64")
  };
}

export async function verifyPassword(password: string, passwordHash: string, passwordSalt: string) {
  try {
    const expected = Buffer.from(passwordHash, "base64");
    const salt = Buffer.from(passwordSalt, "base64");
    if (expected.length !== SCRYPT_KEY_LENGTH || salt.length < 16) return false;
    const actual = await deriveKey(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function deriveKey(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
