import { SearchInputSchema, SearchResult } from '../models/knowledge.js';
import { createLogger } from '../utils/logger.js';
import type { EmbeddingService } from '../services/embedder.js';
import type { QdrantService } from '../storage/qdrant.js';
import type { SQLiteService } from '../storage/sqlite.js';

const logger = createLogger('SearchTool');

export interface SearchToolDeps {
  embedder: EmbeddingService;
  qdrant: QdrantService;
  sqlite: SQLiteService;
  hybridEnabled?: boolean;
  denseWeight?: number;
  sparseWeight?: number;
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

  // Search Qdrant (dense/semantic search)
  const denseResults = await deps.qdrant.search(
    queryEmbedding,
    Object.keys(filters).length > 0 ? filters : undefined,
    (data.limit || 10) * 2, // Get more for merging
    data.min_score || 0.5
  );

  // Hybrid search: combine with keyword search
  const hybridEnabled = deps.hybridEnabled ?? true;
  const denseWeight = deps.denseWeight ?? 0.7;
  const sparseWeight = deps.sparseWeight ?? 0.3;

  let mergedResults: SearchResult[];

  if (hybridEnabled) {
    // Keyword search (sparse/BM25)
    const keywordResults = deps.sqlite.keywordSearch(data.query, {
      project_id: data.project_id,
      limit: (data.limit || 10) * 2,
    });

    // Create score maps
    const denseScores = new Map<string, number>();
    const sparseScores = new Map<string, number>();
    const resultMap = new Map<string, SearchResult>();

    // Process dense results
    for (const result of denseResults) {
      const existing = denseScores.get(result.id);
      if (!existing || result.score > existing) {
        denseScores.set(result.id, result.score);
        resultMap.set(result.id, result);
      }
    }

    // Process sparse results
    for (const kw of keywordResults) {
      sparseScores.set(kw.id, kw.score);
      // If not in resultMap, fetch from sqlite
      if (!resultMap.has(kw.id)) {
        const entry = deps.sqlite.getEntry(kw.id);
        if (entry) {
          resultMap.set(kw.id, {
            id: entry.id,
            score: 0,
            content: entry.content,
            content_preview: entry.content.slice(0, 200),
            type: entry.type,
            tags: entry.tags,
            project_id: entry.project_id,
            created_at: entry.created_at,
          });
        }
      }
    }

    // Combine scores using Reciprocal Rank Fusion (RRF)
    const combinedScores = new Map<string, number>();
    const k = 60; // RRF constant

    // RRF for dense results
    const denseRanked = [...denseScores.entries()].sort((a, b) => b[1] - a[1]);
    denseRanked.forEach(([id], rank) => {
      const rrf = 1 / (k + rank + 1);
      combinedScores.set(id, (combinedScores.get(id) || 0) + denseWeight * rrf);
    });

    // RRF for sparse results
    const sparseRanked = [...sparseScores.entries()].sort((a, b) => b[1] - a[1]);
    sparseRanked.forEach(([id], rank) => {
      const rrf = 1 / (k + rank + 1);
      combinedScores.set(id, (combinedScores.get(id) || 0) + sparseWeight * rrf);
    });

    // Sort by combined score
    const sortedIds = [...combinedScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, data.limit || 10)
      .map(([id]) => id);

    mergedResults = sortedIds
      .map(id => {
        const result = resultMap.get(id);
        if (result) {
          return { ...result, score: combinedScores.get(id) || 0 };
        }
        return null;
      })
      .filter((r): r is SearchResult => r !== null);

    logger.info(`Hybrid search: ${denseResults.length} dense + ${keywordResults.length} keyword = ${mergedResults.length} merged`);
  } else {
    // Deduplicate by entry_id (keep highest score chunk)
    const deduped = new Map<string, SearchResult>();
    for (const result of denseResults) {
      const existing = deduped.get(result.id);
      if (!existing || result.score > existing.score) {
        deduped.set(result.id, result);
      }
    }
    mergedResults = Array.from(deduped.values()).slice(0, data.limit || 10);
  }

  // Update access stats for found entries
  const uniqueIds = [...new Set(mergedResults.map((r) => r.id))];
  for (const id of uniqueIds) {
    deps.sqlite.updateAccessStats(id);
  }

  logger.info(`Found ${mergedResults.length} results`);

  return {
    success: true,
    results: mergedResults,
    message: `Found ${mergedResults.length} results`,
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
