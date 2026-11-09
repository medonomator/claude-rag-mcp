import { z } from 'zod';
import { homedir } from 'os';
import { join } from 'path';

const ConfigSchema = z.object({
  // Embedding
  embeddingProvider: z.enum(['openai', 'ollama']).default('openai'),
  openaiApiKey: z.string().optional(),
  embeddingModel: z.string().default('text-embedding-3-small'),
  embeddingDimensions: z.number().default(1536),
  ollamaUrl: z.string().default('http://localhost:11434'),
  ollamaModel: z.string().default('nomic-embed-text'),

  // Qdrant
  qdrantUrl: z.string().default('http://localhost:6333'),
  qdrantApiKey: z.string().optional(),
  qdrantCollection: z.string().default('claude_rag'),

  // SQLite
  sqlitePath: z.string().default(join(homedir(), '.claude-rag', 'data.db')),

  // Redis
  redisUrl: z.string().default('redis://localhost:6379'),
  redisEnabled: z.boolean().default(false),

  // Chunking
  chunkSize: z.number().default(512),
  chunkOverlap: z.number().default(50),

  // Search
  defaultSearchLimit: z.number().default(10),
  minScoreThreshold: z.number().default(0.5),
  hybridSearchEnabled: z.boolean().default(true),
  denseWeight: z.number().default(0.7),
  sparseWeight: z.number().default(0.3),

  // Auto-tagging
  autoTaggingEnabled: z.boolean().default(true),

  // Logging
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  logFile: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function expandPath(path: string): string {
  if (path.startsWith('~')) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

export function loadConfig(): Config {
  const raw = {
    embeddingProvider: process.env.EMBEDDING_PROVIDER || 'openai',
    openaiApiKey: process.env.OPENAI_API_KEY,
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    embeddingDimensions: parseNumber(process.env.EMBEDDING_DIMENSIONS, 1536),
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'nomic-embed-text',

    qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
    qdrantApiKey: process.env.QDRANT_API_KEY,
    qdrantCollection: process.env.QDRANT_COLLECTION || 'claude_rag',

    sqlitePath: expandPath(process.env.SQLITE_PATH || '~/.claude-rag/data.db'),

    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    redisEnabled: parseBoolean(process.env.REDIS_ENABLED, false),

    chunkSize: parseNumber(process.env.CHUNK_SIZE, 512),
    chunkOverlap: parseNumber(process.env.CHUNK_OVERLAP, 50),

    defaultSearchLimit: parseNumber(process.env.DEFAULT_SEARCH_LIMIT, 10),
    minScoreThreshold: parseNumber(process.env.MIN_SCORE_THRESHOLD, 0.5),
    hybridSearchEnabled: parseBoolean(process.env.HYBRID_SEARCH_ENABLED, true),
    denseWeight: parseNumber(process.env.DENSE_WEIGHT, 0.7) / 10,
    sparseWeight: parseNumber(process.env.SPARSE_WEIGHT, 0.3) / 10,

    autoTaggingEnabled: parseBoolean(process.env.AUTO_TAGGING_ENABLED, true),

    logLevel: process.env.LOG_LEVEL || 'info',
    logFile: process.env.LOG_FILE ? expandPath(process.env.LOG_FILE) : undefined,
  };

  return ConfigSchema.parse(raw);
}
