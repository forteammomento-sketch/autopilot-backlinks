/**
 * Mutable status for the fixture environment, in its own module so the reader
 * and the mutator can both use it without importing each other.
 *
 * Resets on server restart. Nothing here pretends to be persisted.
 */
export type FixtureStatus = 'draft' | 'approved' | 'deployed' | 'rejected';

const overrides = new Map<string, FixtureStatus>();

export function setFixtureStatus(id: string, status: FixtureStatus): void {
  overrides.set(id, status);
}

export function getFixtureStatus(id: string, fallback: FixtureStatus): FixtureStatus {
  return overrides.get(id) ?? fallback;
}
