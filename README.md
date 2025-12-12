# Claude RAG MCP Server

MCP server for Claude Code with RAG (Retrieval-Augmented Generation) capabilities. Automatically saves and indexes your coding sessions for semantic search.

## Features

- **Semantic Search** - Find solutions by meaning, not just keywords
- **Auto-chunking** - Intelligent text splitting with overlap
- **Project Isolation** - Data organized by project
- **Flexible Storage** - Qdrant (vectors) + SQLite (metadata)
- **Multiple Embedding Providers** - OpenAI or Ollama (local)
- **Knowledge Types** - Solutions, commands, code, notes, bugfixes, architecture

## Quick Start

### 1. Prerequisites

- Node.js 20+
- Docker (for Qdrant)
- OpenAI API key (or Ollama for local embeddings)

### 2. Start Qdrant

```bash
cd docker
docker-compose up -d
```

### 3. Install & Build

```bash
npm install
npm run build
```

### 4. Configure Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "rag": {
      "command": "node",
      "args": ["/path/to/claude-rag-mcp/dist/index.js"],
      "env": {
        "EMBEDDING_PROVIDER": "openai",
        "OPENAI_API_KEY": "sk-your-key",
        "QDRANT_URL": "http://localhost:6333"
      }
    }
  }
}
```

### 5. Restart Claude Code

## Usage

### Save Knowledge

```
rag_save: Save a solution about XYZ
- content: "To fix the simulator issue, run xcrun simctl boot <UDID>"
- type: "solution"
- project_id: "confyday-ios"
- tags: ["xcode", "simulator"]
```

### Search Knowledge

```
rag_search: Find solutions about simulators
- query: "how to fix simulator"
- project_id: "confyday-ios"
```

### List Entries

```
rag_list: Show all saved knowledge
- project_id: "confyday-ios"
- type: "solution"
```

### Delete Entry

```
rag_delete: Remove entry
- id: "uuid-here"
```

## Tools Reference

| Tool | Description |
|------|-------------|
| `rag_save` | Save knowledge (solution, command, code, note, bugfix, architecture) |
| `rag_search` | Semantic search with filters |
| `rag_list` | List entries with pagination |
| `rag_delete` | Delete by ID |

## Configuration

### Environment Variables

```bash
# Embedding Provider: openai | ollama
EMBEDDING_PROVIDER=openai

# OpenAI
OPENAI_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small  # or text-embedding-3-large
EMBEDDING_DIMENSIONS=1536               # 1536 for small, 3072 for large

# Ollama (local, free)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=nomic-embed-text

# Qdrant
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=claude_rag

# SQLite
SQLITE_PATH=~/.claude-rag/data.db

# Chunking
CHUNK_SIZE=512
CHUNK_OVERLAP=50

# Search
DEFAULT_SEARCH_LIMIT=10
MIN_SCORE_THRESHOLD=0.5

# Logging
LOG_LEVEL=info  # debug | info | warn | error
```

## Using Ollama (Free, Local)

1. Install Ollama: https://ollama.ai
2. Pull embedding model:
   ```bash
   ollama pull nomic-embed-text
   ```
3. Set environment:
   ```bash
   EMBEDDING_PROVIDER=ollama
   OLLAMA_URL=http://localhost:11434
   OLLAMA_MODEL=nomic-embed-text
   ```

## Architecture

```
┌─────────────────────────────────────────┐
│            Claude Code                   │
│  rag_save()  rag_search()  rag_list()   │
└──────────────────┬──────────────────────┘
                   │ stdio (JSON-RPC)
┌──────────────────▼──────────────────────┐
│          MCP RAG Server                  │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ Chunker  │  │ Embedder │  │ Tools  │ │
│  └──────────┘  └──────────┘  └────────┘ │
└──────────────────┬──────────────────────┘
        ┌──────────┴──────────┐
        │                     │
┌───────▼───────┐    ┌───────▼───────┐
│    Qdrant     │    │    SQLite     │
│   (vectors)   │    │  (metadata)   │
└───────────────┘    └───────────────┘
```

## Development

```bash
# Watch mode
npm run dev

# Run tests
npm test

# Lint
npm run lint

# Format
npm run format
```

## Cost Estimation

| Embedding Model | Cost per 1M tokens |
|-----------------|-------------------|
| text-embedding-3-small | $0.02 |
| text-embedding-3-large | $0.13 |
| Ollama (local) | Free |

For typical usage (~100K tokens/month): **< $0.01/month** with OpenAI small.

## License

MIT

## Links

- [MCP Documentation](https://modelcontextprotocol.io/)
- [Qdrant Documentation](https://qdrant.tech/documentation/)
- [OpenAI Embeddings](https://platform.openai.com/docs/guides/embeddings)
