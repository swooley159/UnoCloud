/**
 * Encryption utilities for storing sensitive data
 */

import crypto from 'crypto';
import os from 'os';

// Derive a machine-specific key for encryption
// In production, consider using a proper key management system
function getMachineKey(): Buffer {
  const machineId = `${os.hostname()}-${os.platform()}-${os.arch()}`;
  return crypto.scryptSync(machineId, 'unocloud-salt', 32);
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt a string value
 */
export function encrypt(plaintext: string): string {
  const key = getMachineKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encryptedData (all hex encoded)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an encrypted string value
 */
export function decrypt(encryptedData: string): string {
  const key = getMachineKey();

  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Check if a string is encrypted (matches our format)
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;

  // Check if parts are valid hex
  const hexRegex = /^[0-9a-f]+$/i;
  return parts.every(part => hexRegex.test(part));
}
