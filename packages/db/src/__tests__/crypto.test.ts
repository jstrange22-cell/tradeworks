import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt, deriveKey, encryptApiKey, decryptApiKey } from '../crypto.js';

// ---------------------------------------------------------------------------
// Core encrypt / decrypt
// ---------------------------------------------------------------------------

describe('encrypt + decrypt', () => {
  const masterKey = 'test-master-key-for-unit-tests-2024';

  it('should round-trip a short string', () => {
    const plaintext = 'hello-world';
    const encrypted = encrypt(plaintext, masterKey);
    const decrypted = decrypt(encrypted, masterKey);
    expect(decrypted).toBe(plaintext);
  });

  it('should round-trip a long API key', () => {
    const apiKey = 'sk-live-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF';
    const encrypted = encrypt(apiKey, masterKey);
    const decrypted = decrypt(encrypted, masterKey);
    expect(decrypted).toBe(apiKey);
  });

  it('should round-trip an empty string', () => {
    const encrypted = encrypt('', masterKey);
    const decrypted = decrypt(encrypted, masterKey);
    expect(decrypted).toBe('');
  });

  it('should round-trip unicode content', () => {
    const plaintext = 'api-key-with-special-chars: !@#$%^&*() \u00e9\u00e8\u00ea';
    const encrypted = encrypt(plaintext, masterKey);
    const decrypted = decrypt(encrypted, masterKey);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext each time (random salt + IV)', () => {
    const plaintext = 'same-plaintext';
    const enc1 = encrypt(plaintext, masterKey);
    const enc2 = encrypt(plaintext, masterKey);

    // Both decrypt to the same value
    expect(decrypt(enc1, masterKey)).toBe(plaintext);
    expect(decrypt(enc2, masterKey)).toBe(plaintext);

    // But the encrypted buffers differ (different salt + IV)
    expect(enc1.equals(enc2)).toBe(false);
  });

  it('should fail to decrypt with the wrong key', () => {
    const encrypted = encrypt('secret-data', masterKey);
    expect(() => decrypt(encrypted, 'wrong-key')).toThrow();
  });

  it('should fail to decrypt a tampered ciphertext', () => {
    const encrypted = encrypt('secret-data', masterKey);
    // Flip a byte in the ciphertext area (after salt+iv+authTag = 44 bytes)
    if (encrypted.length > 44) {
      encrypted[44] ^= 0xff;
    }
    expect(() => decrypt(encrypted, masterKey)).toThrow();
  });

  it('should fail to decrypt a tampered auth tag', () => {
    const encrypted = encrypt('secret-data', masterKey);
    // Flip a byte in the auth tag area (bytes 28-43)
    encrypted[30] ^= 0xff;
    expect(() => decrypt(encrypted, masterKey)).toThrow();
  });

  it('should produce a buffer with expected minimum length', () => {
    // salt(16) + iv(12) + authTag(16) + ciphertext(>= 0) = 44 minimum
    const encrypted = encrypt('', masterKey);
    expect(encrypted.length).toBeGreaterThanOrEqual(44);
  });

  it('should produce larger buffer for larger plaintext', () => {
    const short = encrypt('a', masterKey);
    const long = encrypt('a'.repeat(1000), masterKey);
    expect(long.length).toBeGreaterThan(short.length);
  });
});

// ---------------------------------------------------------------------------
// deriveKey
// ---------------------------------------------------------------------------

describe('deriveKey', () => {
  it('should produce a 32-byte key', () => {
    const salt = Buffer.from('0123456789abcdef'); // 16 bytes
    const key = deriveKey('test-password', salt);
    expect(key.length).toBe(32);
  });

  it('should produce deterministic output for same inputs', () => {
    const salt = Buffer.from('fixed-salt-value');
    const key1 = deriveKey('password', salt);
    const key2 = deriveKey('password', salt);
    expect(key1.equals(key2)).toBe(true);
  });

  it('should produce different output for different salts', () => {
    const key1 = deriveKey('password', Buffer.from('salt-one-1234567'));
    const key2 = deriveKey('password', Buffer.from('salt-two-1234567'));
    expect(key1.equals(key2)).toBe(false);
  });

  it('should produce different output for different passwords', () => {
    const salt = Buffer.from('same-salt-123456');
    const key1 = deriveKey('password-a', salt);
    const key2 = deriveKey('password-b', salt);
    expect(key1.equals(key2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// encryptApiKey / decryptApiKey (env-var based)
// ---------------------------------------------------------------------------

describe('encryptApiKey / decryptApiKey', () => {
  const originalEnv = process.env.API_KEY_ENCRYPTION_SECRET;

  beforeEach(() => {
    process.env.API_KEY_ENCRYPTION_SECRET = 'test-env-secret-for-api-keys';
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.API_KEY_ENCRYPTION_SECRET = originalEnv;
    } else {
      delete process.env.API_KEY_ENCRYPTION_SECRET;
    }
  });

  it('should round-trip an API key', () => {
    const key = 'sk-live-abc123def456ghi789';
    const encrypted = encryptApiKey(key);
    const decrypted = decryptApiKey(encrypted);
    expect(decrypted).toBe(key);
  });

  it('should throw if API_KEY_ENCRYPTION_SECRET is not set (encrypt)', () => {
    delete process.env.API_KEY_ENCRYPTION_SECRET;
    expect(() => encryptApiKey('some-key')).toThrow('API_KEY_ENCRYPTION_SECRET');
  });

  it('should throw if API_KEY_ENCRYPTION_SECRET is not set (decrypt)', () => {
    const encrypted = encryptApiKey('some-key'); // encrypt while env is set
    delete process.env.API_KEY_ENCRYPTION_SECRET;
    expect(() => decryptApiKey(encrypted)).toThrow('API_KEY_ENCRYPTION_SECRET');
  });

  it('should throw if API_KEY_ENCRYPTION_SECRET is empty string', () => {
    process.env.API_KEY_ENCRYPTION_SECRET = '';
    expect(() => encryptApiKey('some-key')).toThrow('API_KEY_ENCRYPTION_SECRET');
  });
});
