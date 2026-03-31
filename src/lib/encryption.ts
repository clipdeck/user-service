import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config';
import { logger } from './logger';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKeyBuffer(): Buffer | null {
  if (!config.socialEncryptionKey) {
    return null;
  }
  // Key must be 32 bytes for AES-256. Accept hex-encoded (64 chars) or raw 32-byte string.
  const key = config.socialEncryptionKey;
  if (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
    return Buffer.from(key, 'hex');
  }
  if (key.length >= 32) {
    return Buffer.from(key.slice(0, 32), 'utf8');
  }
  logger.warn('SOCIAL_ENCRYPTION_KEY is too short (need 32+ chars or 64 hex chars). Tokens will be stored in plaintext.');
  return null;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a string in the format: `iv:authTag:ciphertext` (all base64-encoded).
 * If no encryption key is configured, returns the plaintext as-is (dev mode).
 */
export function encrypt(plaintext: string): string {
  const keyBuffer = getKeyBuffer();
  if (!keyBuffer) {
    return plaintext;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyBuffer, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt an encrypted string in the format `iv:authTag:ciphertext` (all base64).
 * If the string doesn't match the expected format (no colons), assumes plaintext (dev mode).
 */
export function decrypt(encrypted: string): string {
  const keyBuffer = getKeyBuffer();
  if (!keyBuffer) {
    return encrypted;
  }

  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    // Not in encrypted format — likely stored as plaintext before encryption was enabled
    return encrypted;
  }

  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
