import type { UserToolRunDomainStatus, UserToolRunRunner, UserToolRunRuntime } from '../execution/userToolRun.contract';

import type { PersistenceConfig } from '../../types/persistence';

/**
 * Contrat domaine des documents "lean" consommés par le builder de snapshot
 * workspace (US-RC-03 lot 1 — remplace les typages lâches du utils/workspaceSnapshot).
 *
 * Source de vérité pour les statuts/runtimes/runners de run :
 * `domain/execution/userToolRun.contract.ts`.
 */

export interface SnapshotIdLike {
  toString(): string;
}

/** ObjectId Mongoose ou chaîne déjà sérialisée. */
export type SnapshotId = string | SnapshotIdLike;

export interface SnapshotWorkflowDoc {
  _id?: SnapshotId | null;
  id?: string | null;
  name: string;
  description?: string;
  isActive: boolean;
  isDefault?: boolean;
  isDirty?: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastSavedAt?: Date;
  toObject?: () => Record<string, unknown>;
}

export interface SnapshotEdgeDoc {
  _id?: SnapshotId | null;
  id?: string | null;
  sourceInstanceId?: SnapshotId | null;
  sourceId?: string;
  sourceNodeId?: string;
  targetInstanceId?: SnapshotId | null;
  targetId?: string;
  targetNodeId?: string;
  edgeType?: string;
  type?: string;
  label?: string;
}

export interface SnapshotAgentPrototypeDoc {
  _id?: SnapshotId | null;
  id?: string | null;
  name: string;
  llmProvider: string;
  llmModel: string;
  role?: string;
  systemPrompt?: string;
  capabilities?: unknown;
  tools?: unknown;
  toolSelections?: unknown;
  historyConfig?: unknown;
  outputConfig?: unknown;
  robotId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SnapshotAgentInstanceDoc {
  _id?: SnapshotId | null;
  id?: string | null;
  name?: string;
  role?: string;
  llmProvider?: string;
  llmModel?: string;
  systemPrompt?: string;
  capabilities?: string[];
  tools?: unknown;
  legacyTools?: unknown;
  toolSelections?: unknown;
  historyConfig?: unknown;
  outputConfig?: unknown;
  functionInheritance?: unknown;
  localLLMProfileId?: string | null;
  robotId?: string;
  position?: { x: number; y: number };
  content?: unknown;
  persistenceConfig?: PersistenceConfig;
  webSearchParams?: unknown;
  createdAt?: Date;
  toObject?: () => SnapshotAgentInstanceDoc;
}

export interface SnapshotUserToolRunDoc {
  _id?: SnapshotId | null;
  id?: string | null;
  executionId: string;
  toolId?: SnapshotId | null;
  toolVersionTag: string;
  toolContentHash: string;
  workflowId?: SnapshotId | null;
  agentPrototypeId?: SnapshotId | null;
  agentInstanceId?: SnapshotId | null;
  launchContext: 'editor_test' | 'workflow_run' | 'system_validation';
  status: UserToolRunDomainStatus;
  runtime: UserToolRunRuntime;
  runner: UserToolRunRunner;
  inputs?: Record<string, unknown> | null;
  outputs?: {
    result?: unknown;
    stdout?: string;
    stderr?: string;
    artifacts?: Array<{ path: string; kind: 'file' | 'json' | 'log' }>;
  } | null;
  error?: {
    code?: string;
    message: string;
    retryable?: boolean;
  } | null;
  timing?: {
    queuedAt?: Date | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    durationMs?: number | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SnapshotLLMConfigDoc {
  _id?: SnapshotId | null;
  id?: string | null;
  provider: string;
  enabled: boolean;
  apiKeyEncrypted?: string | null;
  capabilities?: Record<string, boolean>;
  updatedAt: Date;
}

export interface SnapshotJournalEntryDoc {
  _id?: SnapshotId | null;
  agentInstanceId?: SnapshotId | null;
  type?: string;
  timestamp?: Date;
  payload?: unknown;
}

/** Nœud agent projeté vers le frontend dans le snapshot workspace. */
export interface SnapshotAgentInstanceNode {
  id?: string | null;
  name?: string;
  llmProvider?: string;
  llmModel?: string;
  systemPrompt?: string;
  provider?: string;
  model?: string;
  systemInstruction?: string;
  position?: { x: number; y: number };
  createdAt?: Date;
  chatMessages?: unknown[];
  configuration_json?: { position?: { x: number; y: number } } & Record<string, unknown>;
  [key: string]: unknown;
}

/** Message chat projeté depuis une entrée agent_journals. */
export interface ProjectedChatMessage {
  id?: string | null;
  sender: string;
  text: string;
  timestamp?: Date;
  [key: string]: unknown;
}

/** Sérialise un ObjectId-like ou une chaîne en string (sans typage lâche). */
export function snapshotIdToString(value: SnapshotId | null | undefined): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : value.toString();
}
