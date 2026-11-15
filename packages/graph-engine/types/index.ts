export type GraphLayoutMode =
  | "orbit"
  | "rings"
  | "circle"
  | "areas"
  | "links"
  | "timeline";

export type GraphThemeId =
  | "obsidian"
  | "blueprint"
  | "neon"
  | "phosphor"
  | "amber";

export type GraphNodeKind =
  | "project"
  | "note"
  | "artifact"
  | "entity"
  | "concept"
  | "wiki_page"
  | "collection"
  | "source"
  | "doctrine"
  | "idea"
  | "custom";

export type GraphEdgeType =
  | "mentions"
  | "derived_from"
  | "supports"
  | "contradicts"
  | "depends_on"
  | "implements"
  | "authored_by"
  | "belongs_to"
  | "relates_to"
  | "references"
  | "cited_in_source"
  | "supersedes";

export type ReviewState = "proposed" | "approved" | "rejected";

export interface Coordinates3D {
  x: number;
  y: number;
  z: number;
}

export interface NodeLayoutPositions {
  orbit: Coordinates3D;
  rings: Coordinates3D;
  circle: Coordinates3D;
  areas: Coordinates3D;
  links: Coordinates3D;
  timeline: Coordinates3D;
}

export interface GraphThemeConfig {
  id: GraphThemeId;
  name: string;
  bg: string;
  canvasBg: string;
  fogColor: string;
  gridColor: string;
  textColor: string;
  accentColor: string;
  lineOpacity: number;
}

export interface NodeKindMeta {
  kind: GraphNodeKind;
  label: string;
  shape: "cube" | "sphere" | "diamond" | "octahedron" | "cylinder" | "torus";
  color: string;
}

export interface ClusterHubConfig {
  key: string;
  label: string;
  x: number;
  y: number;
  z: number;
  color: string;
}

export interface GraphNode {
  id: string;
  vaultPath?: string | null;
  title: string;
  category: string;
  kind: GraphNodeKind;
  cluster: string;
  summary: string;
  content: string;
  aliases?: string[];
  tags: string[];
  props?: Record<string, unknown>;
  connections: string[];
  stalenessDays: number;
  needsAttention: boolean;
  isKeyAnchor: boolean;
  radius: number;
  x: number;
  y: number;
  z: number;
  color?: string;
  reviewState?: ReviewState;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  targetPositions?: NodeLayoutPositions;
}

export interface GraphEdge {
  id: string;
  fromId: string;
  toId: string;
  edgeType: GraphEdgeType | string;
  confidence: number;
  reviewState: ReviewState;
  sourceId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface GraphNeighbor {
  nodeId: string;
  depth: number;
  kind: string;
  title: string;
}

export interface KnowledgeClaim {
  id: string;
  nodeId: string;
  claimText: string;
  sourceId: string | null;
  locator: string | null;
  confidence: number;
  reviewState: ReviewState;
  createdAt?: string;
}

export interface GraphSubgraph {
  rootId: string | null;
  maxDepth: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  neighbors: GraphNeighbor[];
}

export interface GraphSearchCitation {
  sourceId: string;
  title?: string;
  locator: string | null;
  claimText: string;
}

export type SearchProvenance = "keyword" | "vector" | "keyword+vector" | "graph";

export interface GraphSearchResult {
  nodeId: string;
  kind: string;
  title: string;
  snippet: string;
  ftsRank: number | null;
  vecRank: number | null;
  cosineSimilarity: number;
  rrfScore: number;
  via?: SearchProvenance;
  citations: GraphSearchCitation[];
}

export interface TrendGapItem {
  conceptId: string;
  conceptTitle: string;
  recentSourceCount: number;
  lastUpdated: string;
  supportingSources: string[];
}

export interface CompetitorCoverageItem {
  channelId: string;
  channelTitle: string;
  handleOrUrl: string;
  summariesLogged: number;
  topicsCovered: string[];
}

export interface ArmoryPipelineCard {
  ideaId: string;
  title: string;
  status: "idea" | "researching" | "scripted" | "published";
  hook: string;
  updatedAt: string;
}

export interface CreatorDashboardData {
  trendGaps: TrendGapItem[];
  competitors: CompetitorCoverageItem[];
  pipeline: ArmoryPipelineCard[];
  counts: {
    totalNodes: number;
    vaultNotes: number;
    concepts: number;
    entities: number;
    sources: number;
    doctrines: number;
    ideas: number;
    edges: number;
  };
}

export interface VaultSyncStats {
  vaultPath: string;
  totalNotes: number;
  embeddedNotes: number;
  skippedUnchanged: number;
  prunedNodes: number;
  edgesSynced: number;
  estimatedTokens?: number;
  repoBrainPath?: string;
}

export interface EgoGraphData {
  centerId: string | null;
  hops: number;
  nodes: Array<{
    id: string;
    title: string;
    kind: string;
    cluster: string;
    hopDistance: number;
    vaultPath?: string | null;
  }>;
  edges: Array<{
    id: string;
    fromId: string;
    toId: string;
    edgeType: string;
    confidence: number;
  }>;
}

export interface ResearchSourceConfig {
  name: string;
  kind: "youtube" | "arxiv" | "rss";
  url?: string;
  handle?: string;
  channel_id?: string;
  categories?: string[];
  fetch?: number;
  priority?: number;
  tags?: string[];
  include?: string[];
  exclude?: string[];
}

export interface ResearchRunReport {
  started: string;
  finished: string;
  vault: string;
  fetched: Record<string, number>;
  dropped: string[];
  processedInbox?: string[];
  createdSummaries?: string[];
  errors: string[];
  syncStats?: VaultSyncStats | null;
}

export interface ResearchStatusData {
  sources: ResearchSourceConfig[];
  budgetPerRun: number;
  maxPerSource: number;
  pendingInboxFiles: string[];
  seenCount: number;
  cachedChannels: Record<string, string>;
  recentRuns: ResearchRunReport[];
}

export interface ExtractedEntity {
  canonicalName: string;
  entityType: string;
  description: string;
  aliases?: string[];
}

export interface ExtractedConcept {
  name: string;
  domain: string;
  summary: string;
}

export interface ExtractedRelationship {
  fromName: string;
  toName: string;
  edgeType: string;
  confidence: number;
  evidenceQuote?: string;
}

export interface KnowledgeExtractionResult {
  entities: ExtractedEntity[];
  concepts: ExtractedConcept[];
  relationships: ExtractedRelationship[];
  claims: Array<{
    claimText: string;
    verbatimQuote: string;
    locator?: string;
    confidence: number;
  }>;
  summary: string;
  tags: string[];
  isFallback?: boolean;
}

export interface WikiDigestResult {
  title: string;
  category: string;
  summary: string;
  fullMarkdown: string;
  tags: string[];
  connectedConcepts: string[];
  importance: "High" | "Medium" | "Low";
}

export interface CreateGraphNodeInput {
  id?: string;
  title: string;
  kind?: GraphNodeKind;
  category?: string;
  cluster?: string;
  summary?: string;
  content?: string;
  tags?: string[];
  isKeyAnchor?: boolean;
  x?: number;
  y?: number;
  z?: number;
  autoExtractLinks?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdateGraphNodeInput {
  title?: string;
  kind?: GraphNodeKind;
  category?: string;
  cluster?: string;
  summary?: string;
  content?: string;
  tags?: string[];
  isKeyAnchor?: boolean;
  needsAttention?: boolean;
  reviewState?: ReviewState;
  x?: number;
  y?: number;
  z?: number;
  metadata?: Record<string, unknown>;
}

export interface LinkGraphNodesInput {
  fromId: string;
  toId: string;
  edgeType?: GraphEdgeType | string;
  confidence?: number;
  sourceId?: string;
  metadata?: Record<string, unknown>;
}

export interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  node: GraphNode | null;
}

export interface GraphStorageAdapter {
  fetchGraph(rootId?: string, depth?: number): Promise<GraphSubgraph>;
  createNode(
    input: CreateGraphNodeInput
  ): Promise<{ node: GraphNode; createdEdges: GraphEdge[]; chunksIndexed?: number }>;
  updateNode(id: string, input: UpdateGraphNodeInput): Promise<GraphNode>;
  deleteNode(id: string): Promise<void>;
  linkNodes(input: LinkGraphNodesInput): Promise<GraphEdge>;
  unlinkEdge(edgeId: string): Promise<void>;
  searchGraph(query: string, limit?: number): Promise<GraphSearchResult[]>;
  fetchNodeClaims?(nodeId: string): Promise<KnowledgeClaim[]>;
  askNodeContext?(
    nodeId: string,
    question: string
  ): Promise<{ answer: string; model?: string }>;
  digestNote?(
    rawNote: string,
    categories?: string[]
  ): Promise<WikiDigestResult>;
  syncVault?(options?: {
    vaultPath?: string;
    enableAiEnrichment?: boolean;
  }): Promise<VaultSyncStats>;
  fetchCreatorStats?(): Promise<CreatorDashboardData>;
  fetchEgoGraph?(nodeId?: string | null, hops?: number): Promise<EgoGraphData>;
}
