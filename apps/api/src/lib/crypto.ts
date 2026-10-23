import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

/**
 * AES-256-GCM field encryption for gov IDs and other secrets at rest.
 * Format: `v1.<iv>.<authTag>.<ciphertext>`, each part base64.
 */
export function createFieldCipher(hexKey: string) {
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');

  function encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(
      '.',
    );
  }

  function decrypt(payload: string): string {
    const [version, iv, tag, ct] = payload.split('.');
    if (version !== VERSION || !iv || !tag || ct === undefined) {
      throw new Error('Unrecognised encrypted value');
    }
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString(
      'utf8',
    );
  }

  const encryptNullable = (v: string | null): string | null => (v === null ? null : encrypt(v));
  const decryptNullable = (v: string | null): string | null => (v === null ? null : decrypt(v));

  return { encrypt, decrypt, encryptNullable, decryptNullable };
}

export type FieldCipher = ReturnType<typeof createFieldCipher>;
