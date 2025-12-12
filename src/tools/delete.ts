import { DeleteInputSchema } from '../models/knowledge.js';
import { createLogger } from '../utils/logger.js';
import type { QdrantService } from '../storage/qdrant.js';
import type { SQLiteService } from '../storage/sqlite.js';

const logger = createLogger('DeleteTool');

export interface DeleteToolDeps {
  qdrant: QdrantService;
  sqlite: SQLiteService;
}

export async function executeDelete(
  input: unknown,
  deps: DeleteToolDeps
): Promise<{ success: boolean; message: string }> {
  // Validate input
  const parsed = DeleteInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid input: ${parsed.error.message}`,
    };
  }

  const { id } = parsed.data;
  logger.info(`Deleting entry: ${id}`);

  // Check if exists
  const entry = deps.sqlite.getEntry(id);
  if (!entry) {
    return {
      success: false,
      message: `Entry not found: ${id}`,
    };
  }

  // Delete from Qdrant
  await deps.qdrant.deleteByEntryId(id);

  // Delete from SQLite
  deps.sqlite.deleteEntry(id);

  logger.info(`Deleted entry ${id}`);

  return {
    success: true,
    message: `Deleted entry: ${id}`,
  };
}

export const deleteToolDefinition = {
  name: 'rag_delete',
  description: 'Delete a knowledge entry by ID',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: {
        type: 'string',
        description: 'Entry ID to delete (UUID)',
      },
    },
    required: ['id'],
  },
};
