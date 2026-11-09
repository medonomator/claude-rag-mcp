import { UpdateInputSchema } from '../models/knowledge.js';
import { createLogger } from '../utils/logger.js';
import type { SQLiteService } from '../storage/sqlite.js';

const logger = createLogger('UpdateTool');

export interface UpdateToolDeps {
  sqlite: SQLiteService;
}

export async function executeUpdate(
  input: unknown,
  deps: UpdateToolDeps
): Promise<{ success: boolean; message: string }> {
  // Validate input
  const parsed = UpdateInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid input: ${parsed.error.message}`,
    };
  }

  const data = parsed.data;
  logger.info(`Updating entry: ${data.id}`);

  // Check if entry exists
  const existing = deps.sqlite.getEntry(data.id);
  if (!existing) {
    return {
      success: false,
      message: `Entry not found: ${data.id}`,
    };
  }

  // Build updates
  const updates: { tags?: string[]; metadata?: Record<string, unknown> } = {};

  if (data.tags !== undefined) {
    updates.tags = data.tags;
  }

  if (data.metadata !== undefined) {
    updates.metadata = { ...existing.metadata, ...data.metadata };
  }

  if (Object.keys(updates).length === 0) {
    return {
      success: false,
      message: 'No updates provided',
    };
  }

  // Update entry
  const success = deps.sqlite.updateEntry(data.id, updates);

  if (success) {
    logger.info(`Updated entry ${data.id}`);
    return {
      success: true,
      message: `Entry updated successfully: ${data.id}`,
    };
  }

  return {
    success: false,
    message: 'Failed to update entry',
  };
}

export const updateToolDefinition = {
  name: 'rag_update',
  description: 'Update an existing knowledge entry. Can modify tags and metadata.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: {
        type: 'string',
        description: 'Entry ID to update (UUID)',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'New tags (replaces existing)',
      },
      metadata: {
        type: 'object',
        description: 'Metadata to merge with existing',
      },
    },
    required: ['id'],
  },
};
