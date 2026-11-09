import { z } from 'zod';
import { createLogger } from '../utils/logger.js';
import type { EmbeddingService } from '../services/embedder.js';
import type { QdrantService } from '../storage/qdrant.js';
import type { SQLiteService } from '../storage/sqlite.js';
import type { SearchResult } from '../models/knowledge.js';

const logger = createLogger('SimilarTool');

export const SimilarInputSchema = z.object({
  id: z.string().uuid().describe('Entry ID to find similar entries for'),
  limit: z.number().min(1).max(50).optional().default(5).describe('Max results'),
  min_score: z.number().min(0).max(1).optional().default(0.6).describe('Minimum similarity score'),
  exclude_same_project: z.boolean().optional().default(false).describe('Exclude entries from the same project'),
});

export type SimilarInput = z.infer<typeof SimilarInputSchema>;

export interface SimilarToolDeps {
  embedder: EmbeddingService;
  qdrant: QdrantService;
  sqlite: SQLiteService;
}

export async function executeSimilar(
  input: unknown,
  deps: SimilarToolDeps
): Promise<{ success: boolean; results?: SearchResult[]; message: string }> {
  // Validate input
  const parsed = SimilarInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid input: ${parsed.error.message}`,
    };
  }

  const data = parsed.data;
  logger.info(`Finding similar to entry: ${data.id}`);

  // Get the source entry
  const entry = deps.sqlite.getEntry(data.id);
  if (!entry) {
    return {
      success: false,
      message: `Entry not found: ${data.id}`,
    };
  }

  // Generate embedding for the content
  const embedding = await deps.embedder.embed(entry.content);

  // Search for similar entries (get more than limit to filter out source)
  const results = await deps.qdrant.search(
    embedding,
    data.exclude_same_project ? undefined : undefined, // We'll filter manually
    data.limit + 5, // Get extra to account for filtering
    data.min_score
  );

  // Filter out the source entry and optionally same project
  const filtered = results.filter((r) => {
    if (r.id === data.id) return false;
    if (data.exclude_same_project && r.project_id === entry.project_id) return false;
    return true;
  });

  // Deduplicate by entry_id (keep highest score chunk)
  const deduped = new Map<string, SearchResult>();
  for (const result of filtered) {
    const existing = deduped.get(result.id);
    if (!existing || result.score > existing.score) {
      deduped.set(result.id, result);
    }
  }

  const finalResults = Array.from(deduped.values()).slice(0, data.limit);

  // Update access stats for found entries
  for (const result of finalResults) {
    deps.sqlite.updateAccessStats(result.id);
  }

  logger.info(`Found ${finalResults.length} similar entries`);

  return {
    success: true,
    results: finalResults,
    message: `Found ${finalResults.length} similar entries`,
  };
}

export const similarToolDefinition = {
  name: 'rag_similar',
  description: 'Find entries similar to a given entry. Useful for discovering related knowledge.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: {
        type: 'string',
        description: 'Entry ID to find similar entries for (UUID)',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 5)',
      },
      min_score: {
        type: 'number',
        description: 'Minimum similarity score 0-1 (default: 0.6)',
      },
      exclude_same_project: {
        type: 'boolean',
        description: 'Exclude entries from the same project (default: false)',
      },
    },
    required: ['id'],
  },
};
