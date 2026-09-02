import { fixtureDataSource } from '@/lib/data/fixtures';
import type { DataSource } from '@/lib/data/types';

/**
 * The single place a screen gets data.
 *
 * Fixtures today. A Supabase implementation slots in here and no component
 * changes — which is the point of routing every screen through the interface
 * rather than letting pages reach for a client directly.
 */
export const data: DataSource = fixtureDataSource;

export type * from '@/lib/data/types';
