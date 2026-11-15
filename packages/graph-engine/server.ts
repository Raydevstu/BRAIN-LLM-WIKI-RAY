export * from "./types";
export {
  dbQuery,
  dbTransaction,
  getRawExecutor,
  isRemotePostgresUrl,
  toUuid,
  sha256Hex,
} from "./database/client";
export type { QueryExecutor } from "./database/client";
export { ensureGraphSchemaMigrated } from "./database/migrate";
export {
  EMBEDDING_MODEL,
  EMBEDDING_DIM,
  embedText1536,
  generateDeterministicEmbedding,
  chunkText,
} from "./services/embeddings";
export {
  extractKnowledgeWithAiOrFallback,
  linkAndIndexNode,
  computeLineLocator,
  extractExplicitWikiLinks,
  resolveOrCreateNodeByName,
} from "./services/linker";
export { hybridGraphSearch } from "./services/search";
export {
  generateWikiDigest,
  generateNodeContextAnswer,
} from "./services/ai-context";
export { seedDefaultGraphIfEmpty } from "./services/seed";
export {
  loadVaultNotes,
  parseFrontmatterAndBody,
  syncVaultToDatabase,
  exportVaultRepoBrainJson,
} from "./services/vault-sync";
export {
  getResearchStatus,
  addResearchSource,
  removeResearchSource,
  processVaultInbox,
  runResearchPipeline,
} from "./services/research-agent";
export {
  getTrendGapWidget,
  getCompetitorCoverageMatrix,
  getCreatorPipelineBoard,
  getCreatorDashboardData,
  getFilteredEgoGraph,
} from "./api/creator-widgets";
export { createGraphApiHandlers } from "./api/handlers";
export type { GraphAuthGuard, GraphApiConfig } from "./api/handlers";
