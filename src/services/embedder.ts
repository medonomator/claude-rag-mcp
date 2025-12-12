import OpenAI from 'openai';
import { Config } from '../models/config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Embedder');

export interface EmbeddingService {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
}

class OpenAIEmbedder implements EmbeddingService {
  private client: OpenAI;
  private model: string;
  private dimensions: number;

  constructor(config: Config) {
    if (!config.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is required for OpenAI embeddings');
    }

    this.client = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.embeddingModel;
    this.dimensions = config.embeddingDimensions;
    logger.info(`Initialized OpenAI embedder with model: ${this.model}`);
  }

  async embed(text: string): Promise<number[]> {
    const cleaned = text.slice(0, 8191);

    const response = await this.client.embeddings.create({
      model: this.model,
      input: cleaned,
      dimensions: this.dimensions,
    });

    return response.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const cleaned = texts.map((t) => t.slice(0, 8191));

    const response = await this.client.embeddings.create({
      model: this.model,
      input: cleaned,
      dimensions: this.dimensions,
    });

    return response.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }

  getDimensions(): number {
    return this.dimensions;
  }
}

class OllamaEmbedder implements EmbeddingService {
  private baseUrl: string;
  private model: string;
  private dimensions: number;

  constructor(config: Config) {
    this.baseUrl = config.ollamaUrl;
    this.model = config.ollamaModel;
    // nomic-embed-text produces 768-dimensional embeddings
    this.dimensions = 768;
    logger.info(`Initialized Ollama embedder with model: ${this.model}`);
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.statusText}`);
    }

    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama doesn't support batch, so we parallelize
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  getDimensions(): number {
    return this.dimensions;
  }
}

export function createEmbedder(config: Config): EmbeddingService {
  if (config.embeddingProvider === 'ollama') {
    return new OllamaEmbedder(config);
  }
  return new OpenAIEmbedder(config);
}
