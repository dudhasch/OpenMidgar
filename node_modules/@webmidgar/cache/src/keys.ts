/**
 * Cache-Key-Schema (Masterplan Phase 2.2 / ADR-008):
 * `{sourceFingerprint}/{parserVersion}/{canonicalId}/{stufe}`
 * Eine Parserkorrektur (Versionssprung) invalidiert automatisch nur die
 * betroffene Stufe; der Quellindex (S0) bleibt unberührt.
 */

export type CacheStage = 's1' | 's2';

export function assetKey(
  sourceFingerprint: string,
  parserVersion: number,
  canonicalId: string,
  stage: CacheStage,
): string {
  return `${sourceFingerprint}/${parserVersion}/${canonicalId}/${stage}`;
}
