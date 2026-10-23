import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';

const ISSUER = 'PayrollPH';

export function newTotpSecret(): string {
  return generateSecret();
}

export async function totpEnrollment(
  secret: string,
  email: string,
): Promise<{ otpauthUrl: string; qrDataUrl: string }> {
  const otpauthUrl = generateURI({ issuer: ISSUER, label: email, secret });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
  return { otpauthUrl, qrDataUrl };
}

/** Accept the current code and one 30-second step either side for clock drift. */
export async function verifyTotp(secret: string, token: string): Promise<boolean> {
  const result = await verify({ secret, token, epochTolerance: 30 });
  return result.valid;
}
