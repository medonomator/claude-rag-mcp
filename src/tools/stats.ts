import { z } from 'zod';
import { createLogger } from '../utils/logger.js';
import type { SQLiteService } from '../storage/sqlite.js';
import type { QdrantService } from '../storage/qdrant.js';

const logger = createLogger('StatsTool');

export const StatsInputSchema = z.object({
  project_id: z.string().optional().describe('Filter by project'),
});

export type StatsInput = z.infer<typeof StatsInputSchema>;

export interface StatsToolDeps {
  sqlite: SQLiteService;
  qdrant: QdrantService;
}

export interface StatsResult {
  total_entries: number;
  by_type: Record<string, number>;
  by_project: Record<string, number>;
  qdrant_healthy: boolean;
}

export async function executeStats(
  input: unknown,
  deps: StatsToolDeps
): Promise<{ success: boolean; stats?: StatsResult; message: string }> {
  // Validate input
  const parsed = StatsInputSchema.safeParse(input || {});
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid input: ${parsed.error.message}`,
    };
  }

  const data = parsed.data;
  logger.info(`Getting stats${data.project_id ? ` for project: ${data.project_id}` : ''}`);

  try {
    // Get SQLite stats
    const sqliteStats = deps.sqlite.getStats(data.project_id);

    // Check Qdrant health
    const qdrantHealthy = await deps.qdrant.health();

    const stats: StatsResult = {
      ...sqliteStats,
      qdrant_healthy: qdrantHealthy,
    };

    logger.info(`Stats: ${stats.total_entries} entries`);

    return {
      success: true,
      stats,
      message: `Total: ${stats.total_entries} entries`,
    };
  } catch (error) {
    logger.error('Failed to get stats', error);
    return {
      success: false,
      message: `Failed to get stats: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export const statsToolDefinition = {
  name: 'rag_stats',
  description: 'Get statistics about the RAG knowledge base. Shows total entries, breakdown by type and project.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      project_id: {
        type: 'string',
        description: 'Filter stats by project (optional)',
      },
    },
  },
};
