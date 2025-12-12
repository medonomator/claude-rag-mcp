# Claude RAG MCP Server — Архитектурный План

## 1. ОБЗОР ПРОЕКТА

### 1.1 Цель
Создать MCP сервер для Claude Code, который автоматически сохраняет и индексирует диалоги, решения, команды и код для последующего семантического поиска.

### 1.2 Ключевые возможности
- **Auto-save** — автоматическое сохранение важных решений из диалогов
- **Semantic search** — поиск по смыслу, не только по ключевым словам
- **Project isolation** — данные изолированы по проектам
- **Tagging system** — гибкая система тегов и категорий
- **Hybrid search** — комбинация dense (embeddings) + sparse (BM25) поиска
- **Export/Import** — экспорт данных в Markdown/JSON

### 1.3 Use Cases
```
1. "Как мы решали проблему с симулятором?" → находит решение из прошлых сессий
2. "Покажи все команды для Xcode" → фильтрует по тегу + проекту
3. "Что мы делали с HomeScreen.swift?" → поиск по файлам
4. Auto-save: Claude сам сохраняет важные решения при работе
```

---

## 2. АРХИТЕКТУРА

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code                               │
│                                                                  │
│  mcp__rag__save()    mcp__rag__search()    mcp__rag__list()    │
└──────────────────────────────┬──────────────────────────────────┘
                               │ JSON-RPC (stdio)
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                     MCP RAG Server                               │
│                     (TypeScript/Node.js)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Tools     │  │  Chunker    │  │   Embedding Service     │  │
│  │   Handler   │──│  Service    │──│   (OpenAI / Local)      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│         │                                      │                 │
│  ┌──────▼──────────────────────────────────────▼──────────────┐ │
│  │                    Storage Layer                            │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │ │
│  │  │   Qdrant     │  │   SQLite     │  │   File System    │  │ │
│  │  │  (vectors)   │  │  (metadata)  │  │   (backups)      │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                               │
                    Docker Compose Network
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
┌───────▼───────┐    ┌─────────▼─────────┐    ┌──────▼──────┐
│    Qdrant     │    │     Redis         │    │  PostgreSQL │
│   :6333       │    │    (cache)        │    │  (optional) │
│               │    │    :6379          │    │    :5432    │
└───────────────┘    └───────────────────┘    └─────────────┘
```

### 2.2 Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         SAVE FLOW                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Input (text/code)                                              │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────┐                                                │
│  │  Chunker    │─── Split into 512-token chunks with overlap   │
│  └──────┬──────┘                                                │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────┐                                                │
│  │  Embedder   │─── Generate embeddings (OpenAI / Local)       │
│  └──────┬──────┘                                                │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────┐    ┌─────────────┐                             │
│  │   Qdrant    │    │   SQLite    │                             │
│  │  (vectors)  │    │ (metadata)  │                             │
│  └─────────────┘    └─────────────┘                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        SEARCH FLOW                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Query                                                          │
│    │                                                            │
│    ├──────────────┬──────────────┐                              │
│    │              │              │                              │
│    ▼              ▼              ▼                              │
│  Embed      BM25 Sparse    Metadata Filter                     │
│    │              │              │                              │
│    └──────────────┴──────────────┘                              │
│                   │                                              │
│                   ▼                                              │
│            ┌─────────────┐                                       │
│            │   Fusion    │─── RRF (Reciprocal Rank Fusion)      │
│            └──────┬──────┘                                       │
│                   │                                              │
│                   ▼                                              │
│            ┌─────────────┐                                       │
│            │  Reranker   │─── (optional) Cross-encoder          │
│            └──────┬──────┘                                       │
│                   │                                              │
│                   ▼                                              │
│              Results                                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. MCP TOOLS

### 3.1 Core Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `rag_save` | Сохранить знание | content, type, tags, project_id, metadata |
| `rag_search` | Семантический поиск | query, project_id, filters, limit |
| `rag_list` | Список сохранённых записей | project_id, type, tags, date_range |
| `rag_delete` | Удалить запись | id |
| `rag_update` | Обновить метаданные | id, tags, metadata |
| `rag_export` | Экспорт в Markdown/JSON | project_id, format |
| `rag_stats` | Статистика по базе | project_id |

### 3.2 Tool Schemas

```typescript
// rag_save
{
  name: "rag_save",
  description: "Save knowledge to RAG database for future retrieval",
  inputSchema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "Content to save (text, code, solution)"
      },
      type: {
        type: "string",
        enum: ["solution", "command", "code", "note", "bugfix", "architecture"],
        description: "Type of knowledge"
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Tags for categorization"
      },
      project_id: {
        type: "string",
        description: "Project identifier (e.g., 'confyday-ios')"
      },
      files: {
        type: "array",
        items: { type: "string" },
        description: "Related file paths"
      },
      metadata: {
        type: "object",
        description: "Additional metadata"
      }
    },
    required: ["content", "type", "project_id"]
  }
}

// rag_search
{
  name: "rag_search",
  description: "Search knowledge base semantically",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query"
      },
      project_id: {
        type: "string",
        description: "Filter by project"
      },
      types: {
        type: "array",
        items: { type: "string" },
        description: "Filter by knowledge types"
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Filter by tags"
      },
      date_from: {
        type: "string",
        format: "date",
        description: "Filter from date"
      },
      date_to: {
        type: "string",
        format: "date",
        description: "Filter to date"
      },
      limit: {
        type: "number",
        default: 10,
        description: "Max results"
      },
      min_score: {
        type: "number",
        default: 0.5,
        description: "Minimum relevance score (0-1)"
      }
    },
    required: ["query"]
  }
}
```

---

## 4. DATA MODELS

### 4.1 Knowledge Entry

```typescript
interface KnowledgeEntry {
  // Identifiers
  id: string;                    // UUID
  project_id: string;            // e.g., "confyday-ios"

  // Content
  content: string;               // Original content
  content_hash: string;          // SHA256 for deduplication

  // Classification
  type: KnowledgeType;           // solution | command | code | note | bugfix | architecture
  tags: string[];                // ["xcode", "simulator", "swift"]

  // Context
  files: string[];               // Related file paths
  language?: string;             // Programming language
  framework?: string;            // Framework (react, swiftui, etc.)

  // Chunking
  chunks: ChunkEntry[];          // Chunked content with embeddings

  // Metadata
  metadata: Record<string, any>; // Custom metadata

  // Timestamps
  created_at: Date;
  updated_at: Date;
  accessed_at: Date;             // Last search hit

  // Stats
  access_count: number;          // How many times retrieved
  usefulness_score?: number;     // User feedback (optional)
}

interface ChunkEntry {
  id: string;
  index: number;
  content: string;
  tokens: number;
  embedding: number[];           // Vector (1536 or 3072 dims)
}

type KnowledgeType =
  | "solution"      // Problem solving approach
  | "command"       // CLI command or script
  | "code"          // Code snippet
  | "note"          // General note
  | "bugfix"        // Bug fix description
  | "architecture"; // Architecture decision
```

### 4.2 Qdrant Point Structure

```typescript
interface QdrantPoint {
  id: string;                    // UUID
  vector: number[];              // Embedding vector
  payload: {
    // References
    entry_id: string;            // Parent KnowledgeEntry ID
    chunk_index: number;

    // For filtering
    project_id: string;
    type: string;
    tags: string[];
    language?: string;
    framework?: string;

    // For display
    content_preview: string;     // First 200 chars

    // Timestamps (for range queries)
    created_at: number;          // Unix timestamp

    // Full-text search
    content: string;             // For BM25/sparse search
  };
}
```

### 4.3 SQLite Schema

```sql
-- Main entries table
CREATE TABLE knowledge_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  tags TEXT NOT NULL,  -- JSON array
  files TEXT,          -- JSON array
  language TEXT,
  framework TEXT,
  metadata TEXT,       -- JSON object
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  accessed_at INTEGER,
  access_count INTEGER DEFAULT 0
);

-- Indexes
CREATE INDEX idx_project_id ON knowledge_entries(project_id);
CREATE INDEX idx_type ON knowledge_entries(type);
CREATE INDEX idx_created_at ON knowledge_entries(created_at);
CREATE INDEX idx_content_hash ON knowledge_entries(content_hash);

-- Tags table for efficient tag queries
CREATE TABLE entry_tags (
  entry_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (entry_id, tag),
  FOREIGN KEY (entry_id) REFERENCES knowledge_entries(id)
);

CREATE INDEX idx_tag ON entry_tags(tag);

-- Files table
CREATE TABLE entry_files (
  entry_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  PRIMARY KEY (entry_id, file_path),
  FOREIGN KEY (entry_id) REFERENCES knowledge_entries(id)
);

CREATE INDEX idx_file_path ON entry_files(file_path);

-- Search history (for analytics)
CREATE TABLE search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  project_id TEXT,
  results_count INTEGER,
  top_result_id TEXT,
  created_at INTEGER NOT NULL
);
```

---

## 5. КОНФИГУРАЦИЯ

### 5.1 Environment Variables

```bash
# Embedding Provider
EMBEDDING_PROVIDER=openai          # openai | local | ollama
OPENAI_API_KEY=sk-...              # For OpenAI embeddings
EMBEDDING_MODEL=text-embedding-3-small  # or text-embedding-3-large
EMBEDDING_DIMENSIONS=1536          # 1536 for small, 3072 for large

# Qdrant
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=                    # Optional for local
QDRANT_COLLECTION=claude_rag

# SQLite
SQLITE_PATH=~/.claude-rag/data.db

# Redis (optional, for caching)
REDIS_URL=redis://localhost:6379

# Chunking
CHUNK_SIZE=512                     # tokens
CHUNK_OVERLAP=50                   # tokens

# Search
DEFAULT_SEARCH_LIMIT=10
MIN_SCORE_THRESHOLD=0.5
HYBRID_SEARCH_ENABLED=true
DENSE_WEIGHT=0.7
SPARSE_WEIGHT=0.3

# Logging
LOG_LEVEL=info                     # debug | info | warn | error
LOG_FILE=~/.claude-rag/server.log
```

### 5.2 Claude Code Integration (~/.claude/settings.json)

```json
{
  "mcpServers": {
    "rag": {
      "command": "node",
      "args": ["/path/to/claude-rag-mcp/dist/index.js"],
      "env": {
        "EMBEDDING_PROVIDER": "openai",
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "QDRANT_URL": "http://localhost:6333",
        "SQLITE_PATH": "~/.claude-rag/data.db",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### 5.3 Docker Compose

```yaml
version: '3.8'

services:
  qdrant:
    image: qdrant/qdrant:latest
    container_name: claude-rag-qdrant
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_data:/qdrant/storage
    environment:
      - QDRANT__SERVICE__GRPC_PORT=6334
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6333/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  redis:
    image: redis:7-alpine
    container_name: claude-rag-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    restart: unless-stopped

volumes:
  qdrant_data:
  redis_data:
```

---

## 6. IMPLEMENTATION PLAN

### Phase 1: Foundation (MVP)
**Цель:** Базовая функциональность save/search

- [ ] Project setup (TypeScript, ESM, MCP SDK)
- [ ] Docker compose (Qdrant + Redis)
- [ ] Basic MCP server with stdio transport
- [ ] `rag_save` tool implementation
- [ ] `rag_search` tool implementation
- [ ] OpenAI embeddings integration
- [ ] SQLite metadata storage
- [ ] Basic chunking (fixed size with overlap)
- [ ] Integration tests
- [ ] Claude Code configuration

**Deliverables:**
- Working MCP server
- Save and search functionality
- Docker setup

### Phase 2: Enhanced Search
**Цель:** Улучшенный поиск и фильтрация

- [ ] Hybrid search (dense + sparse)
- [ ] Advanced metadata filtering
- [ ] `rag_list` tool
- [ ] `rag_delete` tool
- [ ] `rag_update` tool
- [ ] Deduplication (content hash)
- [ ] Search history tracking
- [ ] Performance optimization

**Deliverables:**
- Full CRUD operations
- Hybrid search
- Filtering by all metadata fields

### Phase 3: Intelligence
**Цель:** Умные функции

- [ ] Semantic chunking (по смыслу, не по токенам)
- [ ] Auto-tagging (LLM-based)
- [ ] Related entries suggestions
- [ ] Usage analytics
- [ ] `rag_stats` tool
- [ ] Reranking (cross-encoder)
- [ ] Local embedding option (Ollama)

**Deliverables:**
- Smart chunking
- Auto-categorization
- Analytics dashboard

### Phase 4: Production
**Цель:** Production-ready

- [ ] `rag_export` tool (Markdown, JSON)
- [ ] Import from existing notes
- [ ] Backup/restore functionality
- [ ] Multi-user support (optional)
- [ ] Rate limiting
- [ ] Comprehensive logging
- [ ] Documentation
- [ ] npm package publishing

**Deliverables:**
- npm package
- Full documentation
- Production deployment guide

---

## 7. PROJECT STRUCTURE

```
claude-rag-mcp/
├── src/
│   ├── index.ts                 # Entry point
│   ├── server.ts                # MCP Server setup
│   │
│   ├── tools/                   # MCP Tools
│   │   ├── index.ts
│   │   ├── save.ts              # rag_save
│   │   ├── search.ts            # rag_search
│   │   ├── list.ts              # rag_list
│   │   ├── delete.ts            # rag_delete
│   │   ├── update.ts            # rag_update
│   │   ├── export.ts            # rag_export
│   │   └── stats.ts             # rag_stats
│   │
│   ├── services/                # Business logic
│   │   ├── chunker.ts           # Text chunking
│   │   ├── embedder.ts          # Embedding generation
│   │   ├── searcher.ts          # Search logic
│   │   └── deduplicator.ts      # Deduplication
│   │
│   ├── storage/                 # Data layer
│   │   ├── qdrant.ts            # Qdrant client
│   │   ├── sqlite.ts            # SQLite client
│   │   └── cache.ts             # Redis cache
│   │
│   ├── models/                  # TypeScript types
│   │   ├── knowledge.ts
│   │   ├── search.ts
│   │   └── config.ts
│   │
│   └── utils/                   # Utilities
│       ├── logger.ts
│       ├── config.ts
│       ├── hash.ts
│       └── tokenizer.ts
│
├── tests/
│   ├── tools/
│   ├── services/
│   └── integration/
│
├── docker/
│   ├── docker-compose.yml
│   └── qdrant-config.yaml
│
├── scripts/
│   ├── setup.sh                 # Initial setup
│   ├── migrate.ts               # DB migrations
│   └── seed.ts                  # Test data
│
├── docs/
│   ├── SETUP.md
│   ├── USAGE.md
│   └── API.md
│
├── .env.example
├── package.json
├── tsconfig.json
├── README.md
└── LICENSE
```

---

## 8. ТЕХНОЛОГИЧЕСКИЙ СТЕК

| Layer | Technology | Reason |
|-------|------------|--------|
| **Runtime** | Node.js 20+ | LTS, ESM support |
| **Language** | TypeScript 5.x | Type safety |
| **MCP SDK** | @modelcontextprotocol/sdk | Official SDK |
| **Vector DB** | Qdrant | Best OSS, Rust performance, great filtering |
| **Metadata DB** | SQLite (better-sqlite3) | Simple, fast, no server |
| **Cache** | Redis | Embedding cache, rate limiting |
| **Embeddings** | OpenAI text-embedding-3-small | Best quality/price ratio |
| **Embeddings (local)** | Ollama + nomic-embed-text | Privacy, offline |
| **Chunking** | tiktoken | Accurate token counting |
| **Testing** | Vitest | Fast, ESM native |
| **Linting** | ESLint + Prettier | Code quality |
| **Build** | tsup | Fast bundling |

---

## 9. PERFORMANCE TARGETS

| Metric | Target | Notes |
|--------|--------|-------|
| Save latency | < 500ms | Including embedding generation |
| Search latency | < 100ms | For 100K entries |
| Embedding cache hit | > 80% | Redis TTL 24h |
| Storage per 1K entries | < 50MB | Qdrant + SQLite |
| Memory usage | < 200MB | Server process |
| Startup time | < 2s | Cold start |

---

## 10. COST ESTIMATION

### Monthly costs (active usage)

| Item | Usage | Cost |
|------|-------|------|
| OpenAI Embeddings | ~1M tokens/month | ~$0.02 |
| Qdrant (local Docker) | Self-hosted | $0 |
| Redis (local Docker) | Self-hosted | $0 |
| **Total** | | **~$0.02/month** |

### For heavy usage (10M tokens/month)
| Item | Usage | Cost |
|------|-------|------|
| OpenAI Embeddings | 10M tokens | ~$0.20 |
| Or Ollama (local) | - | $0 |

---

## 11. SECURITY CONSIDERATIONS

1. **API Keys** — stored in environment variables, never in code
2. **Data isolation** — project_id enforced on all queries
3. **Input validation** — all tool inputs validated with zod
4. **SQL injection** — parameterized queries only
5. **Rate limiting** — optional Redis-based rate limiting
6. **Logging** — no sensitive data in logs
7. **Backups** — SQLite backup on shutdown

---

## 12. OPEN QUESTIONS

1. **Multi-user support?** — For now, single-user (local)
2. **Cloud sync?** — Phase 4 consideration
3. **Web UI?** — Out of scope, CLI/MCP only
4. **Automatic cleanup?** — TTL for old entries?
5. **Max storage size?** — Configurable limit?

---

## 13. SUCCESS CRITERIA

### MVP (Phase 1)
- [ ] Can save knowledge from Claude Code
- [ ] Can search and retrieve relevant results
- [ ] Results are semantically relevant (not just keyword match)
- [ ] Works offline after initial setup
- [ ] < 500ms save latency
- [ ] < 100ms search latency

### Full Product (Phase 4)
- [ ] All tools implemented and tested
- [ ] Published to npm
- [ ] Documentation complete
- [ ] Used daily in real workflows
- [ ] Positive user feedback

---

## 14. REFERENCES

### Research Sources
- [Anthropic MCP Documentation](https://modelcontextprotocol.io/)
- [Qdrant Documentation](https://qdrant.tech/documentation/)
- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [RAG Best Practices 2025](https://www.pinecone.io/learn/chunking-strategies/)

### Similar Projects
- [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service)
- [rag-memory-mcp](https://github.com/ttommyth/rag-memory-mcp)
- [cognee](https://github.com/topoteretes/cognee)
- [khoj](https://github.com/khoj-ai/khoj)

---

*Document Version: 1.0*
*Created: 2025-12-12*
*Author: Claude + Dmitry*
