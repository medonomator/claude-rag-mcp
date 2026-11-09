import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { Config, loadConfig } from './models/config.js';
import { createLogger, logger } from './utils/logger.js';
import { createEmbedder, EmbeddingService } from './services/embedder.js';
import { createChunker, ChunkerService } from './services/chunker.js';
import { createTagger, TaggerService } from './services/tagger.js';
import { createQdrantStorage, QdrantService } from './storage/qdrant.js';
import { createSQLiteStorage, SQLiteService } from './storage/sqlite.js';

import {
  executeSave,
  saveToolDefinition,
  executeSearch,
  searchToolDefinition,
  executeList,
  listToolDefinition,
  executeDelete,
  deleteToolDefinition,
  executeUpdate,
  updateToolDefinition,
  executeStats,
  statsToolDefinition,
  executeSimilar,
  similarToolDefinition,
} from './tools/index.js';

const serverLogger = createLogger('Server');

export class RAGServer {
  private server: Server;
  private config: Config;
  private embedder!: EmbeddingService;
  private chunker!: ChunkerService;
  private tagger!: TaggerService;
  private qdrant!: QdrantService;
  private sqlite!: SQLiteService;

  constructor() {
    this.config = loadConfig();
    logger.setLevel(this.config.logLevel);

    this.server = new Server(
      {
        name: 'claude-rag-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          saveToolDefinition,
          searchToolDefinition,
          listToolDefinition,
          deleteToolDefinition,
          updateToolDefinition,
          statsToolDefinition,
          similarToolDefinition,
        ],
      };
    });

    // Call tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      serverLogger.debug(`Tool called: ${name}`, args);

      try {
        switch (name) {
          case 'rag_save': {
            const result = await executeSave(args, {
              embedder: this.embedder,
              chunker: this.chunker,
              tagger: this.tagger,
              qdrant: this.qdrant,
              sqlite: this.sqlite,
            });
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'rag_search': {
            const result = await executeSearch(args, {
              embedder: this.embedder,
              qdrant: this.qdrant,
              sqlite: this.sqlite,
              hybridEnabled: this.config.hybridSearchEnabled,
              denseWeight: this.config.denseWeight,
              sparseWeight: this.config.sparseWeight,
            });
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'rag_list': {
            const result = await executeList(args, {
              sqlite: this.sqlite,
            });
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'rag_delete': {
            const result = await executeDelete(args, {
              qdrant: this.qdrant,
              sqlite: this.sqlite,
            });
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'rag_update': {
            const result = await executeUpdate(args, {
              sqlite: this.sqlite,
            });
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'rag_stats': {
            const result = await executeStats(args, {
              sqlite: this.sqlite,
              qdrant: this.qdrant,
            });
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'rag_similar': {
            const result = await executeSimilar(args, {
              embedder: this.embedder,
              qdrant: this.qdrant,
              sqlite: this.sqlite,
            });
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          default:
            return {
              content: [{ type: 'text', text: `Unknown tool: ${name}` }],
              isError: true,
            };
        }
      } catch (error) {
        serverLogger.error(`Tool error: ${name}`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async initialize(): Promise<void> {
    serverLogger.info('Initializing RAG server...');

    // Initialize services
    this.embedder = createEmbedder(this.config);
    this.chunker = createChunker(this.config);
    this.tagger = createTagger(this.config);

    // Initialize storage
    this.sqlite = createSQLiteStorage(this.config);
    this.sqlite.initialize();

    this.qdrant = createQdrantStorage(this.config, this.embedder.getDimensions());
    await this.qdrant.initialize();

    serverLogger.info('RAG server initialized successfully');
  }

  async run(): Promise<void> {
    await this.initialize();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    serverLogger.info('RAG server running on stdio');

    // Handle shutdown
    process.on('SIGINT', () => {
      serverLogger.info('Shutting down...');
      this.sqlite.close();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      serverLogger.info('Shutting down...');
      this.sqlite.close();
      process.exit(0);
    });
  }
}
