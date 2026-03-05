// types.ts
import React from 'react';

export enum LLMProvider {
  Gemini = 'Gemini',
  OpenAI = 'OpenAI',
  Mistral = 'Mistral',
  Anthropic = 'Anthropic',
  Grok = 'Grok',
  Perplexity = 'Perplexity',
  Qwen = 'Qwen',
  Kimi = 'Kimi K2',
  DeepSeek = 'DeepSeek',
  LMStudio = 'LLM local (on premise)',
  ArcLLM = 'Arc-LLM',
}

export enum LLMCapability {
  Chat = 'Chat',
  FileUpload = 'File Analysis',
  URLAnalysis = 'URL Analysis',
  ImageGeneration = 'Image Generation',
  ImageModification = 'Image Modification',
  WebSearch = 'Web Search',
  FunctionCalling = 'Function Calling',
  OutputFormatting = 'Output Formatting',
  Embedding = 'Embedding',
  OCR = 'OCR',
  Reasoning = 'Reasoning Mode',
  CacheOptimization = 'Cache Optimization',
  CodeSpecialization = 'Code Specialization',
  // Arc-LLM specific capabilities
  VideoGeneration = 'Video Generation',
  MapsGrounding = 'Maps Grounding',
  WebSearchGrounding = 'Web Search Grounding', // Distinct from basic WebSearch

  // 🆕 Anthropic Claude 4 - Core Capabilities
  ExtendedThinking = 'Extended Thinking',        // Raisonnement étendu avec thinking blocks
  PDFSupport = 'PDF Support',                    // Support natif des documents PDF
  StructuredOutputs = 'Structured Outputs',      // Sorties structurées avec validation JSON Schema

  // 🆕 Anthropic Claude 4 - Tools (natifs côté Anthropic)
  WebFetchTool = 'Web Fetch Tool',               // Récupération de contenu web (Anthropic exécute)
  WebSearchToolAnthropic = 'Web Search Tool (Anthropic)', // Recherche web native (Anthropic exécute)
}

export interface LLMConfig {
  provider: LLMProvider;
  enabled: boolean;
  apiKey?: string; // For cloud providers (encrypted on backend)
  localEndpoint?: string; // For local providers (plaintext URL, not encrypted)
  capabilities: { [key in LLMCapability]?: boolean };
  hasApiKey?: boolean; // Flag: API key exists
  hasLocalEndpoint?: boolean; // Flag: local endpoint exists
  isLocalProvider?: boolean; // Flag: provider is local (not cloud)
  needsReconfig?: boolean; // True when backend decryption failed (encryption key mismatch)
}

export interface HistoryConfig {
  enabled: boolean;
  llmProvider: LLMProvider;
  model: string;
  role: string;
  systemPrompt: string;
  limits: {
    char: number;
    word: number;
    token: number;
    sentence: number;
    message: number;
  };
}

export interface Tool {
  name: string;
  description: string;
  parameters: any; // JSON Schema object
  outputSchema?: any; // JSON Schema for the tool's return value
}

export type OutputFormat = 'json' | 'xml' | 'yaml' | 'shell' | 'powershell' | 'python' | 'html' | 'css' | 'javascript' | 'typescript' | 'php' | 'sql' | 'mysql' | 'mongodb';

export interface OutputConfig {
  enabled: boolean;
  format: OutputFormat;
  useCodestralCompletion?: boolean;
  // JSON Schema validation for structured outputs
  schema?: object;
}

/**
 * Configuration granulaire de persistance par agent
 * Définit ce qui est sauvegardé pour chaque agent individuellement
 */
export type MediaStorageType = 'db' | 'local' | 'cloud';

/**
 * Types pour le stockage cloud (S3/GCS)
 */
export type CloudProvider = 's3' | 'gcs';

/** Configuration Amazon S3 / MinIO */
export interface S3StorageConfig {
  accessKeyId: string;
  secretAccessKey: string;       // Chiffré côté backend avant stockage
  region: string;
  bucketName: string;
  endpoint?: string;             // Pour MinIO / LocalStack
}

/** Configuration Google Cloud Storage */
export interface GCSStorageConfig {
  projectId: string;
  bucketName: string;
  serviceAccountKey?: string;    // JSON stringifié, chiffré backend
}

/** Configuration cloud complète (discriminated union) */
export interface CloudStorageConfig {
  provider: CloudProvider;
  s3?: S3StorageConfig;
  gcs?: GCSStorageConfig;
}

/** Régions AWS S3 disponibles */
export const S3_REGIONS = [
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-east-2', label: 'US East (Ohio)' },
  { value: 'us-west-1', label: 'US West (N. California)' },
  { value: 'us-west-2', label: 'US West (Oregon)' },
  { value: 'eu-west-1', label: 'EU (Ireland)' },
  { value: 'eu-west-2', label: 'EU (London)' },
  { value: 'eu-west-3', label: 'EU (Paris)' },
  { value: 'eu-central-1', label: 'EU (Frankfurt)' },
  { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
] as const;

export interface PersistenceConfig {
  saveChat: boolean;              // Défaut: true - Sauvegarder les messages de chat
  saveErrors: boolean;            // Défaut: true - Sauvegarder les erreurs rencontrées
  saveHistorySummary: boolean;    // Défaut: false - Générer et stocker un résumé périodique (économie tokens)
  saveLinks: boolean;             // Défaut: false - Sauvegarder les liens entre agents
  saveTasks: boolean;             // Défaut: false - Sauvegarder les tâches assignées
  saveMedia: boolean;             // Default: false
  mediaStorage: MediaStorageType; // Défaut: 'db' - Mode de stockage des médias
  cloudStorageConfig?: CloudStorageConfig;  // Cloud storage config
}

export const defaultPersistenceConfig: PersistenceConfig = {
  saveChat: true,
  saveErrors: true,
  saveHistorySummary: false,
  saveLinks: false,
  saveTasks: false,
  saveMedia: false,               // ⭐ Désactivé par défaut
  mediaStorage: 'db'
};

export interface Agent {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  llmProvider: LLMProvider;
  model: string;
  capabilities: LLMCapability[];
  historyConfig?: HistoryConfig;
  tools?: Tool[];
  outputConfig?: OutputConfig;
  persistenceConfig?: PersistenceConfig; // ⭐ NEW: Configuration de persistance
  // V2 Governance: Robot creator validation
  creator_id: RobotId;
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
  // V2 Workflow: Optional custom instance name when added to workflow
  instanceName?: string;
}

// V2 Governance: Other prototype types by robot specialization

export interface ConnectionPrototype {
  id: string;
  name: string;
  type: 'api' | 'webhook' | 'database' | 'external_service';
  endpoint: string;
  authentication: {
    type: 'bearer' | 'api_key' | 'oauth' | 'basic' | 'none';
    credentials?: Record<string, string>;
  };
  configuration: Record<string, any>;
  creator_id: RobotId; // Must be RobotId.Com
  created_at: string;
  updated_at: string;
}

export interface FilePrototype {
  id: string;
  name: string;
  type: 'upload' | 'transformation' | 'validation' | 'output';
  format: string; // 'json', 'csv', 'pdf', etc.
  validation_rules: Record<string, any>;
  transformation_config?: Record<string, any>;
  creator_id: RobotId; // Must be RobotId.Phil
  created_at: string;
  updated_at: string;
}

export interface EventPrototype {
  id: string;
  name: string;
  type: 'trigger' | 'scheduler' | 'webhook' | 'conditional';
  schedule?: string; // cron expression
  conditions?: Record<string, any>;
  rate_limit?: {
    max_calls: number;
    time_window: number; // seconds
  };
  creator_id: RobotId; // Must be RobotId.Tim
  created_at: string;
  updated_at: string;
}

// Nouvelle distinction : Instance d'un agent dans un workflow
export interface AgentInstance {
  id: string; // ID unique de l'instance
  prototypeId: string; // Référence vers l'Agent prototype
  workflowId?: string; // ⭐ NOUVEAU: ID du workflow contenant cette instance (pour persistance journal)
  name: string; // Peut être différent du prototype (personnalisation)
  position: { x: number; y: number };
  isMinimized: boolean;
  isMaximized: boolean; // Mode agrandissement plein écran workflow
  
  // ⭐ FIX QA: Configuration de persistance au niveau de l'instance
  persistenceConfig?: PersistenceConfig;

  // 🆕 Configuration enrichie (clone du prototype au moment de l'instanciation)
  // null = fallback vers prototype (rétrocompatibilité)
  configuration_json: {
    // Configuration métier (clonée du prototype)
    role: string;
    model: string;
    llmProvider: LLMProvider;
    systemPrompt: string;
    tools: Tool[];
    outputConfig?: OutputConfig;
    capabilities?: LLMCapability[];
    historyConfig?: HistoryConfig;

    // Métadonnées d'instance
    position: { x: number; y: number };

    // 🔮 Sections futures (préparation)
    links?: any[]; // Connexions entre agents
    tasks?: any[]; // Tâches assignées
    logs?: any[]; // Historique d'exécution
    errors?: any[]; // Erreurs rencontrées
  } | null;
}

// Interface pour accéder aux données complètes d'une instance
export interface ResolvedAgentInstance {
  instance: AgentInstance;
  prototype: Agent;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string of arguments
}


// LMStudio Dynamic Route Detection (Jalon 1)
export interface LMStudioRoutes {
  models: boolean;              // GET /v1/models
  chatCompletions: boolean;     // POST /v1/chat/completions
  completions: boolean;         // POST /v1/completions
  embeddings: boolean;          // POST /v1/embeddings
  images: boolean;              // POST /v1/images/generations
  audio: boolean;               // POST /v1/audio/transcriptions
}

export interface LMStudioModelDetection {
  modelId: string;              // Ex: "Mistral-7B-Instruct-v0.2"
  routes: LMStudioRoutes;       // Routes HTTP disponibles
  capabilities: LLMCapability[];// Capacités A-IR-DD2 déduites
  contextWindow?: number;       // Longueur contexte (tokens)
  detectedAt: string;           // ISO timestamp de la détection
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent' | 'tool' | 'tool_result';
  text: string;
  timestamp: Date;  // ⭐ ÉTAPE 3: Pour la persistence et la déduplication
  image?: string; // base64 encoded image
  mimeType?: string;
  filename?: string;
  fileContent?: string; // For Mistral text file content
  citations?: { title: string; uri: string }[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  status?: 'executing_tool';
  isError?: boolean;
  // Maps & Web Search Grounding (Arc-LLM, Gemini)
  mapsGrounding?: MapSource[];
  webSearchGrounding?: WebSearchSource[];
  // Video Generation (Veo 3.1)
  videoGeneration?: {
    operationId: string;
    videoUrl?: string; // Available when completed
    thumbnailUrl?: string;
    prompt: string;
    status: 'processing' | 'completed' | 'failed';
    error?: string;
  };

  // 🆕 Anthropic Claude 4 fields
  thinking?: string;              // Extended thinking content
  document?: string;              // Base64 encoded document (PDF)
  documentType?: 'image' | 'pdf'; // Type de document uploadé
}

export interface WorkflowNode {
  id: string;
  agent: Agent;
  position: { x: number; y: number };
  messages: ChatMessage[];
  isMinimized: boolean;
  isMaximized?: boolean;
  instanceId?: string; // 🆕 Lié à AgentInstance dans le DesignStore
}

// V2 Robot Navigation Interfaces
export enum RobotId {
  Archi = 'AR_001',
  Bos = 'BO_002',
  Com = 'CO_003',
  Phil = 'PH_004',
  Tim = 'TI_005'
}

export interface RobotMenuItem {
  id: RobotId;
  name: string;
  iconComponent: React.ComponentType<any>;
  path: string;
  description: string;
  nestedItems?: RobotMenuItem[];
}

export interface RobotCapability {
  id: string;
  name: string;
  description: string;
  requiresAuth?: boolean;
}

// V2 React Flow Types - Architecture Prototype vs Instance
export interface V2WorkflowNode {
  id: string;
  type: 'agent' | 'connection' | 'event' | 'file';
  position: { x: number; y: number };
  data: {
    robotId: RobotId;
    label: string;
    agent?: Agent; // ⭐ Prototype de l'agent (pour model, systemPrompt par défaut)
    agentInstance?: AgentInstance; // Pour les nodes agent (référence à l'instance)
    workflowId?: string; // ⭐ NOUVEAU: ID du workflow pour persistance journal
    isMinimized?: boolean;
    isMaximized?: boolean; // Mode agrandissement plein écran workflow
  };
}

export interface V2WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type?: 'default' | 'step' | 'smoothstep' | 'straight';
  data?: {
    label?: string;
    conditions?: string[];
  };
}

// V2 Governance System - Robot Creation Rights

export type PrototypeType = 'agent' | 'connection' | 'file' | 'event';

export interface RobotCapabilities {
  canCreate: PrototypeType[];
  canModify: PrototypeType[];
  canDelete: PrototypeType[];
}

export const ROBOT_CREATION_RIGHTS: Record<RobotId, RobotCapabilities> = {
  [RobotId.Archi]: {
    canCreate: ['agent'],
    canModify: ['agent'],
    canDelete: ['agent']
  },
  [RobotId.Com]: {
    canCreate: ['connection'],
    canModify: ['connection'],
    canDelete: ['connection']
  },
  [RobotId.Phil]: {
    canCreate: ['file'],
    canModify: ['file'],
    canDelete: ['file']
  },
  [RobotId.Tim]: {
    canCreate: ['event'],
    canModify: ['event'],
    canDelete: ['event']
  },
  [RobotId.Bos]: {
    canCreate: [], // Bos supervise mais ne crée pas
    canModify: [], // Seulement lecture pour monitoring
    canDelete: [] // Pas de suppression directe
  }
};

export interface GovernanceValidationResult {
  isValid: boolean;
  error?: string;
  robotId: RobotId;
  prototypeType: PrototypeType;
  operation: 'create' | 'modify' | 'delete';
}

// ============================================
// Arc-LLM Specific Types
// ============================================

/**
 * Options pour la génération de vidéo Arc-LLM (Gemini Veo 3.1)
 */
export interface VideoGenerationOptions {
  prompt: string;
  negativePrompt?: string; // Exclude unwanted elements

  // Mode selection
  mode: 'text-to-video' | 'image-to-video' | 'interpolation' | 'extension' | 'with-references';

  // Image-to-video (animate single image as first frame)
  firstFrame?: { mimeType: string; data: string };

  // Interpolation (first + last frame)
  lastFrame?: { mimeType: string; data: string };

  // Extension (continue existing video)
  existingVideo?: { uri: string; operationId: string };

  // Reference images (max 3) for style/content guidance
  referenceImages?: Array<{
    image: { mimeType: string; data: string };
    referenceType: 'asset'; // Gemini uses 'asset' for style references
  }>;

  // Parameters
  resolution?: '720p' | '1080p';
  aspectRatio?: '16:9' | '9:16';
  durationSeconds?: 4 | 6 | 8;
  personGeneration?: 'allow_all' | 'allow_adult' | 'dont_allow';
  seed?: number; // Improves determinism slightly
}

/**
 * Statut d'une génération vidéo (polling asynchrone)
 */
export interface VideoGenerationStatus {
  operationId: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  videoUrl?: string; // Disponible si status = COMPLETED
  progress?: number; // 0-100
  error?: string; // Disponible si status = FAILED
}

/**
 * Source cartographique extraite par Maps Grounding
 * Structure similaire à groundingMetadata de Gemini
 */
export interface MapSource {
  uri: string; // Lien Google Maps
  placeTitle: string;
  placeId: string;
  coordinates: { latitude: number; longitude: number };
  reviewExcerpts?: string[]; // Extraits d'avis utilisateurs
}

/**
 * Source web extraite par Web Search Grounding
 * Structure similaire aux citations Gemini
 */
export interface WebSearchSource {
  uri: string;
  webTitle: string;
  snippet?: string; // Extrait de la source
}

/**
 * Résultat Maps Grounding (pattern similaire à Gemini)
 */
export interface MapsGroundingResponse {
  text: string;
  mapSources: MapSource[];
}

/**
 * Résultat Web Search Grounding (pattern similaire à Gemini)
 */
export interface WebSearchGroundingResponse {
  text: string;
  webSources: WebSearchSource[];
}

// ============================================
// LLM Config UI Types (Phase 2 - Jalon 3)
// ============================================

/**
 * Interface UI pour les configurations LLM
 * Utilisée par le hook useLLMConfigs et les composants React
 * 
 * DUAL STORAGE MODEL:
 * - Cloud providers: use apiKey (encrypted on backend)
 * - Local providers: use localEndpoint (plaintext URL)
 * 
 * NOTE: En mode authentifié, les API keys sont chiffrées côté backend
 * En mode guest (localStorage), aucun chiffrement (mode de développement)
 */
export interface ILLMConfigUI {
  id: string;
  provider: string; // 'OpenAI', 'Anthropic', 'Gemini', 'LLM local (on premise)', etc.
  enabled: boolean;
  capabilities: Record<string, boolean>;
  hasApiKey: boolean; // Flag: API key exists
  hasLocalEndpoint?: boolean; // Flag: local endpoint exists
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  // ⚠️ ONLY in localStorage mode (guest):
  apiKeyPlaintext?: string; // Non-sécurisé, développement uniquement
  // Optional fields for compatibility with SettingsModal state
  // In guest mode: contains actual API key or endpoint
  // In auth mode: empty/undefined (data stored server-side)
  apiKey?: string; // API key (cloud providers)
  localEndpoint?: string; // Endpoint URL (local providers, not encrypted)
}

/**
 * Configuration LLM enrichie avec métadonnées utilisateur
 */
export interface LLMConfigWithUser extends ILLMConfigUI {
  userId: string; // Propriétaire de la config
  lastUsedAt?: string; // Tracking usage
}


// ============================================
// BACKWARD COMPATIBILITY ALIASES
// Mapping ancien code vers V2 types
// ============================================

/** @deprecated Utiliser V2WorkflowEdge */
export type WorkflowEdge = V2WorkflowEdge;

/** Alias pour WorkflowNode ancien vers V2WorkflowNode moderne */
export type V2_WorkflowNodeAlias = V2WorkflowNode;

/**
 * @deprecated Utiliser V2WorkflowNode[]
 * Alias pour backward compatibility avec workflowService.ts
 */
export interface Workflow {
  _id?: string;
  name?: string;
  description?: string;
  nodes: V2WorkflowNode[];
  edges: V2WorkflowEdge[];
  createdAt?: Date;
  updatedAt?: Date;
}

