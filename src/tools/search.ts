import { SearchInput, SearchInputSchema, SearchResult } from '../models/knowledge.js';
import { createLogger } from '../utils/logger.js';
import type { EmbeddingService } from '../services/embedder.js';
import type { QdrantService } from '../storage/qdrant.js';
import type { SQLiteService } from '../storage/sqlite.js';

const logger = createLogger('SearchTool');

export interface SearchToolDeps {
  embedder: EmbeddingService;
  qdrant: QdrantService;
  sqlite: SQLiteService;
}

export async function executeSearch(
  input: unknown,
  deps: SearchToolDeps
): Promise<{ success: boolean; results?: SearchResult[]; message: string }> {
  // Validate input
  const parsed = SearchInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid input: ${parsed.error.message}`,
    };
  }

  const data = parsed.data;
  logger.info(`Searching: query="${data.query.slice(0, 50)}...", project=${data.project_id || 'all'}`);

  // Generate query embedding
  const queryEmbedding = await deps.embedder.embed(data.query);

  // Build filters
  const filters: {
    project_id?: string;
    types?: string[];
    tags?: string[];
    date_from?: number;
    date_to?: number;
  } = {};

  if (data.project_id) {
    filters.project_id = data.project_id;
  }

  if (data.types && data.types.length > 0) {
    filters.types = data.types;
  }

  if (data.tags && data.tags.length > 0) {
    filters.tags = data.tags;
  }

  if (data.date_from) {
    filters.date_from = new Date(data.date_from).getTime();
  }

  if (data.date_to) {
    filters.date_to = new Date(data.date_to).getTime();
  }

  // Search Qdrant
  const results = await deps.qdrant.search(
    queryEmbedding,
    Object.keys(filters).length > 0 ? filters : undefined,
    data.limit || 10,
    data.min_score || 0.5
  );

  // Update access stats for found entries
  const uniqueIds = [...new Set(results.map((r) => r.id))];
  for (const id of uniqueIds) {
    deps.sqlite.updateAccessStats(id);
  }

  // Deduplicate by entry_id (keep highest score chunk)
  const deduped = new Map<string, SearchResult>();
  for (const result of results) {
    const existing = deduped.get(result.id);
    if (!existing || result.score > existing.score) {
      deduped.set(result.id, result);
    }
  }

  const finalResults = Array.from(deduped.values());
  logger.info(`Found ${finalResults.length} results`);

  return {
    success: true,
    results: finalResults,
    message: `Found ${finalResults.length} results`,
  };
}

export const searchToolDefinition = {
  name: 'rag_search',
  description: 'Search knowledge base semantically. Returns relevant content based on meaning, not just keywords.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
      project_id: {
        type: 'string',
        description: 'Filter by project',
      },
      types: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['solution', 'command', 'code', 'note', 'bugfix', 'architecture'],
        },
        description: 'Filter by knowledge types',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by tags',
      },
      date_from: {
        type: 'string',
        description: 'Filter from date (ISO format)',
      },
      date_to: {
        type: 'string',
        description: 'Filter to date (ISO format)',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 10)',
      },
      min_score: {
        type: 'number',
        description: 'Minimum relevance score 0-1 (default: 0.5)',
      },
    },
    required: ['query'],
  },
};
