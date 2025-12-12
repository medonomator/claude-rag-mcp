import { ListInputSchema } from '../models/knowledge.js';
import { createLogger } from '../utils/logger.js';
import type { SQLiteService } from '../storage/sqlite.js';

const logger = createLogger('ListTool');

export interface ListToolDeps {
  sqlite: SQLiteService;
}

export async function executeList(input: unknown, deps: ListToolDeps): Promise<{
  success: boolean;
  entries?: Array<{
    id: string;
    type: string;
    project_id: string;
    tags: string[];
    content_preview: string;
    created_at: string;
  }>;
  message: string;
}> {
  // Validate input
  const parsed = ListInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid input: ${parsed.error.message}`,
    };
  }

  const data = parsed.data;
  logger.info(`Listing entries: project=${data.project_id || 'all'}, type=${data.type || 'all'}`);

  const entries = deps.sqlite.listEntries({
    project_id: data.project_id,
    type: data.type,
    tags: data.tags,
    limit: data.limit || 20,
    offset: data.offset || 0,
  });

  const result = entries.map((e) => ({
    id: e.id,
    type: e.type,
    project_id: e.project_id,
    tags: e.tags,
    content_preview: e.content.slice(0, 200),
    created_at: e.created_at.toISOString(),
  }));

  logger.info(`Listed ${result.length} entries`);

  return {
    success: true,
    entries: result,
    message: `Found ${result.length} entries`,
  };
}

export const listToolDefinition = {
  name: 'rag_list',
  description: 'List saved knowledge entries with optional filters',
  inputSchema: {
    type: 'object' as const,
    properties: {
      project_id: {
        type: 'string',
        description: 'Filter by project',
      },
      type: {
        type: 'string',
        enum: ['solution', 'command', 'code', 'note', 'bugfix', 'architecture'],
        description: 'Filter by type',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by tags',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 20)',
      },
      offset: {
        type: 'number',
        description: 'Offset for pagination',
      },
    },
  },
};
