import { safeStorage } from "electron";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";

// Encrypted blob (macOS Keychain, Windows DPAPI, or libsecret on Linux).
// On platforms where safeStorage is unavailable we fall back to a
// 0600-mode plaintext file — same directory, different name so we never
// accidentally try to decrypt a plaintext blob or vice versa.
const DIR = join(homedir(), ".atrium");
const ENCRYPTED_FILE = join(DIR, "secrets.enc");
const PLAINTEXT_FILE = join(DIR, "secrets.json");

function ensureDir(): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
}

function readAll(): Record<string, unknown> {
  if (safeStorage.isEncryptionAvailable()) {
    if (!existsSync(ENCRYPTED_FILE)) return {};
    try {
      const buf = readFileSync(ENCRYPTED_FILE);
      const decrypted = safeStorage.decryptString(buf);
      return JSON.parse(decrypted);
    } catch {
      return {};
    }
  }
  if (!existsSync(PLAINTEXT_FILE)) return {};
  try {
    return JSON.parse(readFileSync(PLAINTEXT_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, unknown>): void {
  ensureDir();
  const json = JSON.stringify(data);
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(ENCRYPTED_FILE, safeStorage.encryptString(json));
    if (existsSync(PLAINTEXT_FILE)) unlinkSync(PLAINTEXT_FILE);
  } else {
    writeFileSync(PLAINTEXT_FILE, json, { mode: 0o600 });
  }
}

export function getSecret<T = unknown>(key: string): T | undefined {
  return readAll()[key] as T | undefined;
}

export function setSecret(key: string, value: unknown): void {
  const all = readAll();
  all[key] = value;
  writeAll(all);
}

export function deleteSecret(key: string): void {
  const all = readAll();
  if (!(key in all)) return;
  delete all[key];
  writeAll(all);
}

export function hasSecret(key: string): boolean {
  return readAll()[key] !== undefined;
}
