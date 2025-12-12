import { createHash } from 'crypto';

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function generateId(): string {
  return crypto.randomUUID();
}
