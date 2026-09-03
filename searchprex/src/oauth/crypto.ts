import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Envelope encryption for stored OAuth refresh tokens.
 *
 * A refresh token is a permanent key to someone's Search Console. Storing it as
 * plaintext in a database column means every backup, every read replica, every
 * accidental `select *` in a support session, and anyone who ever gets a copy of
 * the database holds that key. Encrypting it at the application layer means the
 * database alone is not enough — an attacker needs the key too, and that lives
 * in the process environment rather than in the data.
 *
 * AES-256-GCM, so the ciphertext is authenticated: a tampered value fails to
 * open rather than decrypting to something attacker-chosen.
 */
export function sealToken(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

export function openToken(sealed: string, key: Buffer): string {
  const raw = Buffer.from(sealed, 'base64');
  if (raw.length <= IV_BYTES + TAG_BYTES) {
    throw new Error('sealed token is too short to be valid');
  }

  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = raw.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  // Throws on a wrong key or a tampered ciphertext, which is the point.
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/**
 * The encryption key from the environment.
 *
 * Requires 32 bytes, given as base64 or hex. A short key is rejected rather
 * than padded or hashed into shape: silently accepting a weak key would leave
 * everyone believing tokens are protected when they are not.
 */
export function encryptionKeyFromEnv(value: string | undefined): Buffer | null {
  if (value === undefined || value.trim() === '') return null;

  const trimmed = value.trim();
  const decoded = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');

  if (decoded.length !== 32) {
    throw new Error(
      'SEARCHPREX_ENCRYPTION_KEY must be 32 bytes, as base64 or hex. Generate one with ' +
        '`openssl rand -base64 32`.',
    );
  }
  return decoded;
}

/** A short, non-reversible label for a token, so logs can identify one safely. */
export function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}
