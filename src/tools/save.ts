import { SaveInput, SaveInputSchema, KnowledgeEntry, ChunkEntry } from '../models/knowledge.js';
import { createLogger } from '../utils/logger.js';
import { hashContent, generateId } from '../utils/hash.js';
import type { EmbeddingService } from '../services/embedder.js';
import type { ChunkerService } from '../services/chunker.js';
import type { QdrantService } from '../storage/qdrant.js';
import type { SQLiteService } from '../storage/sqlite.js';

const logger = createLogger('SaveTool');

export interface SaveToolDeps {
  embedder: EmbeddingService;
  chunker: ChunkerService;
  qdrant: QdrantService;
  sqlite: SQLiteService;
}

export async function executeSave(
  input: unknown,
  deps: SaveToolDeps
): Promise<{ success: boolean; id?: string; message: string }> {
  // Validate input
  const parsed = SaveInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid input: ${parsed.error.message}`,
    };
  }

  const data = parsed.data;
  logger.info(`Saving knowledge: type=${data.type}, project=${data.project_id}`);

  // Check for duplicates
  const contentHash = hashContent(data.content);
  const existing = deps.sqlite.getEntryByHash(contentHash);
  if (existing) {
    logger.debug(`Duplicate content found: ${existing.id}`);
    return {
      success: true,
      id: existing.id,
      message: `Content already exists with ID: ${existing.id}`,
    };
  }

  // Chunk content
  const chunks = deps.chunker.chunk(data.content);
  logger.debug(`Created ${chunks.length} chunks`);

  // Generate embeddings
  const embeddings = await deps.embedder.embedBatch(chunks.map((c) => c.content));

  // Create entry
  const entry: KnowledgeEntry = {
    id: generateId(),
    project_id: data.project_id,
    content: data.content,
    content_hash: contentHash,
    type: data.type,
    tags: data.tags || [],
    files: data.files || [],
    language: data.language,
    framework: data.framework,
    chunks: chunks.map((c, i) => ({
      ...c,
      embedding: embeddings[i],
    })),
    metadata: data.metadata || {},
    created_at: new Date(),
    updated_at: new Date(),
    access_count: 0,
  };

  // Save to SQLite
  deps.sqlite.saveEntry(entry);

  // Save to Qdrant
  await deps.qdrant.upsertPoints(
    entry.id,
    entry.chunks.map((c) => ({
      id: c.id,
      index: c.index,
      content: c.content,
      embedding: c.embedding!,
    })),
    {
      project_id: entry.project_id,
      type: entry.type,
      tags: entry.tags,
      language: entry.language,
      framework: entry.framework,
      created_at: entry.created_at.getTime(),
    }
  );

  logger.info(`Saved entry ${entry.id} with ${chunks.length} chunks`);

  return {
    success: true,
    id: entry.id,
    message: `Saved successfully. ID: ${entry.id}, Chunks: ${chunks.length}`,
  };
}

export const saveToolDefinition = {
  name: 'rag_save',
  description: 'Save knowledge to RAG database for future semantic retrieval. Use this to store solutions, commands, code snippets, notes, bugfixes, or architecture decisions.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      content: {
        type: 'string',
        description: 'Content to save (text, code, solution)',
      },
      type: {
        type: 'string',
        enum: ['solution', 'command', 'code', 'note', 'bugfix', 'architecture'],
        description: 'Type of knowledge',
      },
      project_id: {
        type: 'string',
        description: 'Project identifier (e.g., "confyday-ios")',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for categorization',
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Related file paths',
      },
      language: {
        type: 'string',
        description: 'Programming language',
      },
      framework: {
        type: 'string',
        description: 'Framework',
      },
      metadata: {
        type: 'object',
        description: 'Additional metadata',
      },
    },
    required: ['content', 'type', 'project_id'],
  },
};
