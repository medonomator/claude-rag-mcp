import { RAGServer } from './server.js';

const server = new RAGServer();
server.run().catch((error) => {
  console.error('Failed to start RAG server:', error);
  process.exit(1);
});
