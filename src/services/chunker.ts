import { Config } from '../models/config.js';
import { createLogger } from '../utils/logger.js';
import { generateId } from '../utils/hash.js';
import type { ChunkEntry } from '../models/knowledge.js';

const logger = createLogger('Chunker');

// Approximate token count (1 token ~= 4 chars for mixed content)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface ChunkerService {
  chunk(content: string): ChunkEntry[];
}

class RecursiveChunker implements ChunkerService {
  private chunkSize: number;
  private chunkOverlap: number;
  private separators: string[];

  constructor(config: Config) {
    this.chunkSize = config.chunkSize;
    this.chunkOverlap = config.chunkOverlap;
    this.separators = [
      '\n\n\n', // Triple newline (section breaks)
      '\n\n', // Double newline (paragraphs)
      '\n', // Single newline
      '. ', // Sentences
      ', ', // Clauses
      ' ', // Words
      '', // Characters (fallback)
    ];
    logger.info(`Initialized chunker: size=${this.chunkSize}, overlap=${this.chunkOverlap}`);
  }

  chunk(content: string): ChunkEntry[] {
    const chunks = this.recursiveSplit(content);

    return chunks.map((text, index) => ({
      id: generateId(),
      index,
      content: text,
      tokens: estimateTokens(text),
    }));
  }

  private recursiveSplit(text: string): string[] {
    // Find the best separator that exists in the text
    let separator = '';
    for (const sep of this.separators) {
      if (sep === '' || text.includes(sep)) {
        separator = sep;
        break;
      }
    }

    // Split by separator
    const splits = separator === '' ? Array.from(text) : text.split(separator);

    const chunks: string[] = [];
    let currentChunk = '';
    let currentTokens = 0;

    for (const split of splits) {
      const splitTokens = estimateTokens(split);

      // If adding this split would exceed chunk size
      if (currentTokens + splitTokens > this.chunkSize && currentChunk) {
        chunks.push(currentChunk.trim());

        // Start new chunk with overlap
        const overlapChars = this.chunkOverlap * 4; // Convert tokens to chars
        currentChunk = currentChunk.slice(-overlapChars) + (separator !== '' ? separator : '') + split;
        currentTokens = estimateTokens(currentChunk);
      } else {
        currentChunk += (currentChunk && separator !== '' ? separator : '') + split;
        currentTokens += splitTokens;
      }
    }

    // Add the last chunk
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    // If any chunk is still too large, recursively split it
    const result: string[] = [];
    for (const chunk of chunks) {
      if (estimateTokens(chunk) > this.chunkSize * 1.5) {
        // Find a finer separator and split again
        const finerSeparators = this.separators.slice(this.separators.indexOf(separator) + 1);
        if (finerSeparators.length > 0) {
          const subChunker = new RecursiveChunker({
            chunkSize: this.chunkSize,
            chunkOverlap: this.chunkOverlap,
          } as Config);
          // @ts-expect-error - accessing private for recursion
          subChunker.separators = finerSeparators;
          result.push(...subChunker.recursiveSplit(chunk));
        } else {
          result.push(chunk);
        }
      } else {
        result.push(chunk);
      }
    }

    return result;
  }
}

export function createChunker(config: Config): ChunkerService {
  return new RecursiveChunker(config);
}
