import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits for AES-256
const ALGORITHM = 'aes-256-gcm';

// scryptSync cost parameters
const SCRYPT_N = 16384; // CPU/memory cost
const SCRYPT_R = 8;     // block size
const SCRYPT_P = 1;     // parallelization

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

/**
 * Derive a 32-byte encryption key from a master key and salt using scrypt.
 */
export function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return scryptSync(masterKey, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }) as Buffer;
}

// ---------------------------------------------------------------------------
// Core encrypt / decrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt a plaintext string with AES-256-GCM.
 *
 * Returns a single buffer laid out as:
 *   salt (16 B) | iv (12 B) | authTag (16 B) | ciphertext (variable)
 */
export function encrypt(plaintext: string, masterKey: string): Buffer {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const derivedKey = deriveKey(masterKey, salt);

  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, authTag, ciphertext]);
}

/**
 * Decrypt a buffer previously produced by encrypt().
 *
 * Expects the layout: salt (16 B) | iv (12 B) | authTag (16 B) | ciphertext
 */
export function decrypt(encrypted: Buffer, masterKey: string): string {
  const salt = encrypted.subarray(0, SALT_LENGTH);
  const iv = encrypted.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = encrypted.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
  );
  const ciphertext = encrypted.subarray(
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
  );

  const derivedKey = deriveKey(masterKey, salt);

  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}

// ---------------------------------------------------------------------------
// Helpers for the api_keys table
// ---------------------------------------------------------------------------

function getEncryptionSecret(): string {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      'API_KEY_ENCRYPTION_SECRET environment variable is not set. ' +
        'Cannot encrypt or decrypt API keys without it.',
    );
  }
  return secret;
}

/**
 * Encrypt an API key for storage in the api_keys table.
 * Uses the API_KEY_ENCRYPTION_SECRET environment variable as the master key.
 */
export function encryptApiKey(key: string): Buffer {
  return encrypt(key, getEncryptionSecret());
}

/**
 * Decrypt an API key retrieved from the api_keys table.
 * Uses the API_KEY_ENCRYPTION_SECRET environment variable as the master key.
 */
export function decryptApiKey(encrypted: Buffer): string {
  return decrypt(encrypted, getEncryptionSecret());
}
