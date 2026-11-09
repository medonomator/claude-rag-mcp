import { z } from 'zod';

// Knowledge types
export const KnowledgeTypeEnum = z.enum([
  'solution',
  'command',
  'code',
  'note',
  'bugfix',
  'architecture',
]);

export type KnowledgeType = z.infer<typeof KnowledgeTypeEnum>;

// Chunk entry
export interface ChunkEntry {
  id: string;
  index: number;
  content: string;
  tokens: number;
  embedding?: number[];
}

// Main knowledge entry
export interface KnowledgeEntry {
  id: string;
  project_id: string;
  content: string;
  content_hash: string;
  type: KnowledgeType;
  tags: string[];
  files: string[];
  language?: string;
  framework?: string;
  chunks: ChunkEntry[];
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  accessed_at?: Date;
  access_count: number;
}

// Qdrant point payload
export type QdrantPayload = {
  entry_id: string;
  chunk_index: number;
  project_id: string;
  type: string;
  tags: string[];
  language?: string;
  framework?: string;
  content_preview: string;
  content: string;
  created_at: number;
};

// Input schemas for tools
export const SaveInputSchema = z.object({
  content: z.string().min(1).describe('Content to save (text, code, solution)'),
  type: KnowledgeTypeEnum.describe('Type of knowledge'),
  project_id: z.string().min(1).describe('Project identifier'),
  tags: z.array(z.string()).optional().default([]).describe('Tags for categorization'),
  files: z.array(z.string()).optional().default([]).describe('Related file paths'),
  language: z.string().optional().describe('Programming language'),
  framework: z.string().optional().describe('Framework'),
  metadata: z.record(z.unknown()).optional().default({}).describe('Additional metadata'),
});

export type SaveInput = z.infer<typeof SaveInputSchema>;

export const SearchInputSchema = z.object({
  query: z.string().min(1).describe('Search query'),
  project_id: z.string().optional().describe('Filter by project'),
  types: z.array(KnowledgeTypeEnum).optional().describe('Filter by knowledge types'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  date_from: z.string().optional().describe('Filter from date (ISO format)'),
  date_to: z.string().optional().describe('Filter to date (ISO format)'),
  limit: z.number().min(1).max(100).optional().default(10).describe('Max results'),
  min_score: z.number().min(0).max(1).optional().default(0.5).describe('Minimum relevance score'),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

export const ListInputSchema = z.object({
  project_id: z.string().optional().describe('Filter by project'),
  type: KnowledgeTypeEnum.optional().describe('Filter by type'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  limit: z.number().min(1).max(100).optional().default(20).describe('Max results'),
  offset: z.number().min(0).optional().default(0).describe('Offset for pagination'),
});

export type ListInput = z.infer<typeof ListInputSchema>;

export const DeleteInputSchema = z.object({
  id: z.string().uuid().describe('Entry ID to delete'),
});

export type DeleteInput = z.infer<typeof DeleteInputSchema>;

export const UpdateInputSchema = z.object({
  id: z.string().uuid().describe('Entry ID to update'),
  tags: z.array(z.string()).optional().describe('New tags'),
  metadata: z.record(z.unknown()).optional().describe('New metadata'),
});

export type UpdateInput = z.infer<typeof UpdateInputSchema>;

// Search result
export interface SearchResult {
  id: string;
  score: number;
  content: string;
  content_preview: string;
  type: KnowledgeType;
  tags: string[];
  project_id: string;
  created_at: Date;
  chunk_index?: number;
}
