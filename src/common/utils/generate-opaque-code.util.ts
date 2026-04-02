import { randomBytes } from 'crypto';

export function generateOpaqueCode(length = 16) {
  const safeLength = Math.max(1, Math.floor(length));
  return randomBytes(Math.ceil(safeLength / 2))
    .toString('hex')
    .slice(0, safeLength);
}
