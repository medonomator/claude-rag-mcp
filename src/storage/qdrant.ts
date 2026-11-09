import { QdrantClient, type Schemas } from '@qdrant/js-client-rest';
import { z } from 'zod';
import { Config } from '../models/config.js';
import { createLogger } from '../utils/logger.js';
import { KnowledgeTypeEnum } from '../models/knowledge.js';
import type { QdrantPayload, SearchResult } from '../models/knowledge.js';

const logger = createLogger('Qdrant');

const HitPayloadSchema = z.object({
  entry_id: z.string(),
  chunk_index: z.number(),
  project_id: z.string(),
  type: KnowledgeTypeEnum,
  tags: z.array(z.string()),
  content_preview: z.string(),
  content: z.string(),
  created_at: z.number(),
});

export interface QdrantService {
  initialize(): Promise<void>;
  upsertPoints(
    entryId: string,
    chunks: Array<{
      id: string;
      index: number;
      content: string;
      embedding: number[];
    }>,
    metadata: Omit<QdrantPayload, 'entry_id' | 'chunk_index' | 'content_preview' | 'content'>
  ): Promise<void>;
  search(
    embedding: number[],
    filters?: {
      project_id?: string;
      types?: string[];
      tags?: string[];
      date_from?: number;
      date_to?: number;
    },
    limit?: number,
    minScore?: number
  ): Promise<SearchResult[]>;
  deleteByEntryId(entryId: string): Promise<void>;
  health(): Promise<boolean>;
}

export class QdrantStorage implements QdrantService {
  private client: QdrantClient;
  private collection: string;
  private dimensions: number;

  constructor(config: Config, dimensions: number) {
    const url = new URL(config.qdrantUrl);
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 6333;
    this.client = new QdrantClient({
      url: config.qdrantUrl,
      port,
      apiKey: config.qdrantApiKey || undefined,
    });
    this.collection = config.qdrantCollection;
    this.dimensions = dimensions;
    logger.info(`Initialized Qdrant client: ${config.qdrantUrl}, collection: ${this.collection}`);
  }

  async initialize(): Promise<void> {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some((c) => c.name === this.collection);

      if (!exists) {
        logger.info(`Creating collection: ${this.collection}`);
        await this.client.createCollection(this.collection, {
          vectors: {
            size: this.dimensions,
            distance: 'Cosine',
          },
        });

        // Create indexes for filtering
        const indexFields = ['project_id', 'type', 'entry_id'];
        for (const field of indexFields) {
          await this.client.createPayloadIndex(this.collection, {
            field_name: field,
            field_schema: 'keyword',
          });
        }

        // Timestamp index for range queries
        await this.client.createPayloadIndex(this.collection, {
          field_name: 'created_at',
          field_schema: 'integer',
        });

        logger.info('Collection and indexes created successfully');
      } else {
        logger.debug('Collection already exists');
      }
    } catch (error) {
      logger.error('Failed to initialize Qdrant', error);
      throw error;
    }
  }

  async upsertPoints(
    entryId: string,
    chunks: Array<{
      id: string;
      index: number;
      content: string;
      embedding: number[];
    }>,
    metadata: Omit<QdrantPayload, 'entry_id' | 'chunk_index' | 'content_preview' | 'content'>
  ): Promise<void> {
    const points = chunks.map((chunk) => ({
      id: chunk.id,
      vector: chunk.embedding,
      payload: {
        entry_id: entryId,
        chunk_index: chunk.index,
        content_preview: chunk.content.slice(0, 200),
        content: chunk.content,
        ...metadata,
      } satisfies QdrantPayload,
    }));

    await this.client.upsert(this.collection, {
      wait: true,
      points,
    });

    logger.debug(`Upserted ${points.length} points for entry ${entryId}`);
  }

  async search(
    embedding: number[],
    filters?: {
      project_id?: string;
      types?: string[];
      tags?: string[];
      date_from?: number;
      date_to?: number;
    },
    limit: number = 10,
    minScore: number = 0.5
  ): Promise<SearchResult[]> {
    const must: Array<Record<string, unknown>> = [];

    if (filters?.project_id) {
      must.push({ key: 'project_id', match: { value: filters.project_id } });
    }

    if (filters?.types && filters.types.length > 0) {
      must.push({
        should: filters.types.map((t) => ({ key: 'type', match: { value: t } })),
      });
    }

    if (filters?.tags && filters.tags.length > 0) {
      for (const tag of filters.tags) {
        must.push({ key: 'tags', match: { value: tag } });
      }
    }

    if (filters?.date_from) {
      must.push({ key: 'created_at', range: { gte: filters.date_from } });
    }

    if (filters?.date_to) {
      must.push({ key: 'created_at', range: { lte: filters.date_to } });
    }

    const searchParams: Schemas['SearchRequest'] = {
      vector: embedding,
      limit,
      score_threshold: minScore,
      with_payload: true,
    };

    if (must.length > 0) {
      searchParams.filter = { must };
    }

    const results = await this.client.search(this.collection, searchParams);

    return results.flatMap((hit) => {
      const parsed = HitPayloadSchema.safeParse(hit.payload);
      if (!parsed.success) {
        logger.warn(`Skipping point ${hit.id} with invalid payload`);
        return [];
      }
      const payload = parsed.data;
      return [
        {
          id: payload.entry_id,
          score: hit.score,
          content: payload.content,
          content_preview: payload.content_preview,
          type: payload.type,
          tags: payload.tags,
          project_id: payload.project_id,
          created_at: new Date(payload.created_at),
          chunk_index: payload.chunk_index,
        },
      ];
    });
  }

  async deleteByEntryId(entryId: string): Promise<void> {
    await this.client.delete(this.collection, {
      wait: true,
      filter: {
        must: [{ key: 'entry_id', match: { value: entryId } }],
      },
    });
    logger.debug(`Deleted points for entry ${entryId}`);
  }

  async health(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch {
      return false;
    }
  }
}

export function createQdrantStorage(config: Config, dimensions: number): QdrantService {
  return new QdrantStorage(config, dimensions);
}
