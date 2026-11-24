/**
 * DatabaseInitService - Idempotent MongoDB Initialization
 *
 * ROLE: Ensures database schema, collections, indexes, and validation
 * are properly created and maintained throughout the application lifecycle.
 *
 * DESIGN PRINCIPLES:
 * - Idempotent: Safe to call multiple times (Phase 1: Check, Phase 2: Create if absent)
 * - Non-blocking: Errors logged but don't crash startup
 * - Code-First: All schema definitions in TypeScript, not Docker volumes
 * - Secure: Test user created only in development
 *
 * ARCHITECTURE:
 * - Collections: users, llm_configs, user_settings, workflows, agents,
 *               workflow_nodes, workflow_edges, agent_prototypes, agent_instances
 * - Indexes: Performance optimization on frequently queried fields
 * - Schema Validation: JSON Schema validation on insert/update
 */

import { logger } from './logger';
import mongoose from 'mongoose';
import { asErrorShape, errorMessageOf, isDuplicateKeyError } from '../utils/errorGuards';
import bcrypt from 'bcrypt';
import { backfillMediaReferenceCatalogFields } from '../migrations/006_media_reference_catalog_backfill';
import { migrateLegacyWorkflowGraphsToV2 } from '../migrations/008_workflow_v1_to_v2_migration';
import { nativeFunctionsSeed } from '../seeds/nativeFunctions.seed';
import { NativePythonProvisioningService } from './nativePythonProvisioning.service';
import { mapLegacyFunctionToUserToolFields, type LegacyFunctionLike } from '../utils/userToolLegacyMapper';

const nativePythonProvisioningService = new NativePythonProvisioningService();
const SHARED_HELLO_TEST_TOOL_NAME = 'hello_test';

/**
 * Define MongoDB collection schemas with validation rules
 * IMPORTANT: Schemas are PERMISSIVE (not restrictive)
 * - Mongoose models handle strict validation
 * - MongoDB schemas only enforce document structure basics
 * - additionalProperties: true allows flexible fields
 * - No 'required' arrays to allow partial documents during operations
 */
// ⭐ US-RC-03: types structurels locaux nommes pour le bootstrap (consigne 01-architecte-bdd 2d)
interface CollectionSchemaSpec {
  validator?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

interface IndexSpec {
  spec: mongoose.mongo.IndexSpecification;
  options?: Record<string, unknown>;
}

const COLLECTION_SCHEMAS: Record<string, CollectionSchemaSpec> = {
  users: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          email: { bsonType: 'string' },
          password: { bsonType: 'string' },
          role: { bsonType: 'string' },
          isActive: { bsonType: 'bool' },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' },
        },
      },
    },
  },

  llm_configs: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          userId: { bsonType: 'objectId' },
          provider: { bsonType: 'string' },
          apiKeyEncrypted: { bsonType: 'string' },
          capabilities: { bsonType: 'object' },
          isEnabled: { bsonType: 'bool' },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' },
        },
      },
    },
  },

  user_settings: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          userId: { bsonType: 'objectId' },
          llmConfigs: { bsonType: 'object' },
          preferences: { bsonType: 'object' },
          version: { bsonType: 'int' },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' },
        },
      },
    },
  },

  workflows: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          name: { bsonType: 'string' },
          description: { bsonType: 'string' },
          userId: { bsonType: 'objectId' },
          isActive: { bsonType: 'bool' },
          isDefault: { bsonType: 'bool' },
          isDirty: { bsonType: 'bool' },
          canvasState: { bsonType: 'object' },
          nodes: { bsonType: 'array' },
          edges: { bsonType: 'array' },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' },
          lastSavedAt: { bsonType: 'date' },
        },
      },
    },
  },

  agents: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          name: { bsonType: 'string' },
          description: { bsonType: 'string' },
          tools: { bsonType: 'array' },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' },
        },
      },
    },
  },

  workflow_nodes: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          workflowId: { bsonType: 'objectId' },
          nodeId: { bsonType: 'string' },
          data: { bsonType: 'object' },
          position: { bsonType: 'object' },
        },
      },
    },
  },

  workflow_edges: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          workflowId: { bsonType: 'objectId' },
          edgeId: { bsonType: 'string' },
          source: { bsonType: 'string' },
          target: { bsonType: 'string' },
        },
      },
    },
  },

  agent_prototypes: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          userId: { bsonType: 'objectId' },
          name: { bsonType: 'string' },
          description: { bsonType: 'string' },
          config: { bsonType: 'object' },
          recoveryPolicy: {
            bsonType: ['object', 'null'],
            properties: {
              autoFenceAndRetry: { bsonType: 'bool' },
              maxAttempts: { bsonType: ['int', 'long'] },
            },
          },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' },
        },
      },
    },
  },

  agent_instances: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          agentId: { bsonType: 'objectId' },
          workflowId: { bsonType: 'objectId' },
          executionState: { bsonType: 'object' },
          capabilities: { bsonType: 'array' },
          logs: { bsonType: 'array' },
          recoveryPolicy: {
            bsonType: ['object', 'null'],
            properties: {
              autoFenceAndRetry: { bsonType: 'bool' },
              maxAttempts: { bsonType: ['int', 'long'] },
            },
          },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' },
        },
      },
    },
  },

  agent_templates: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          userId: { bsonType: 'objectId' },
          name: { bsonType: 'string' },
          description: { bsonType: 'string' },
          category: { bsonType: 'string' },
          robotId: { bsonType: 'string' },
          icon: { bsonType: 'string' },
          template: { bsonType: 'object' },
          sourcePrototypeId: { bsonType: 'objectId' },
          usageCount: { bsonType: 'int' },
          isStarred: { bsonType: 'bool' },
          tags: { bsonType: 'array' },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' },
        },
      },
    },
  },

  local_llm_profiles: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          userId: { bsonType: 'objectId' },
          name: { bsonType: 'string' },
          endpoint: { bsonType: 'string' },
          capabilities: { bsonType: 'object' },
          enabled: { bsonType: 'bool' },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' },
        },
      },
    },
  },

  workspaces: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          ownerUserId: { bsonType: 'objectId' },
          scopeType: { bsonType: 'string' },
          scopeId: { bsonType: 'objectId' },
          logicalRoot: { bsonType: 'string' },
          runtimeRoots: { bsonType: 'object' },
          manifests: { bsonType: 'object' },
          status: { bsonType: 'string' },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' },
        },
      },
    },
  },

  user_tools: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          ownerUserId: { bsonType: ['objectId', 'null'] },
          workspaceId: { bsonType: ['objectId', 'null'] },
          workflowId: { bsonType: ['objectId', 'null'] },
          scopeType: { bsonType: 'string' },
          name: { bsonType: 'string' },
          runtime: { bsonType: 'string' },
          status: { bsonType: 'string' },
          currentVersion: { bsonType: 'object' },
          versions: { bsonType: 'array' },
          isEnabled: { bsonType: 'bool' },
          isReadonly: { bsonType: 'bool' },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' },
        },
      },
    },
  },

  user_tool_runs: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          executionId: { bsonType: 'string' },
          ownerUserId: { bsonType: 'objectId' },
          toolId: { bsonType: 'objectId' },
          workflowId: { bsonType: ['objectId', 'null'] },
          agentPrototypeId: { bsonType: ['objectId', 'null'] },
          agentInstanceId: { bsonType: ['objectId', 'null'] },
          retryOfExecutionId: { bsonType: ['string', 'null'] },
          recoveryAttemptCount: { bsonType: ['int', 'long', 'double', 'null'] },
          requestFingerprint: { bsonType: ['string', 'null'] },
          targetFingerprint: { bsonType: ['string', 'null'] },
          privateContextCiphertext: { bsonType: ['string', 'null'] },
          cancellationRequestedAt: { bsonType: ['date', 'null'] },
          cancellationRequestedBy: { bsonType: ['objectId', 'null'] },
          workspaceRetentionProtected: { bsonType: 'bool' },
          reconstructionQuarantine: {
            bsonType: ['object', 'null'],
            properties: {
              code: { bsonType: 'string' },
              quarantinedAt: { bsonType: 'date' },
            },
          },
          reconstructionQuarantineResolution: {
            bsonType: ['object', 'null'],
            properties: {
              code: { bsonType: 'string' },
              quarantinedAt: { bsonType: 'date' },
              resolution: { enum: ['failed'] },
              resolvedAt: { bsonType: 'date' },
              resolvedBy: { bsonType: 'objectId' },
            },
          },
          lease: {
            bsonType: ['object', 'null'],
            properties: {
              owner: { bsonType: 'string' },
              token: { bsonType: 'string' },
              acquiredAt: { bsonType: 'date' },
              expiresAt: { bsonType: 'date' },
            },
          },
          launchContext: { bsonType: 'string' },
          status: { bsonType: 'string' },
          runtime: { bsonType: 'string' },
          runner: { bsonType: 'string' },
          inputs: { bsonType: 'object' },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' },
        },
      },
    },
  },

  gateway_fence_audit: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          actorUserId: { bsonType: 'string' },
          timestamp: { bsonType: 'date' },
          fencedOpUuid: { bsonType: 'string' },
          operationId: { bsonType: 'string' },
          workspaceId: { bsonType: 'string' },
          runId: { bsonType: 'string' },
          reason: { bsonType: 'string' },
          fenceKind: { bsonType: 'string' },
          quiescenceProven: { bsonType: 'bool' },
        },
      },
    },
  },

  runtime_alerts: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          severity: { enum: ['critical', 'high', 'medium', 'low'] },
          code: { bsonType: 'string' },
          message: { bsonType: 'string' },
          userId: { bsonType: 'string' },
          workspaceId: { bsonType: 'string' },
          runId: { bsonType: 'string' },
          operationId: { bsonType: ['string', 'null'] },
          createdAt: { bsonType: 'date' },
          acknowledgedAt: { bsonType: ['date', 'null'] },
        },
      },
    },
  },

  run_command_idempotency: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'string' },
          userId: { bsonType: 'string' },
          command: { bsonType: 'string' },
          idempotencyKey: { bsonType: 'string' },
          workspaceId: { bsonType: 'string' },
          runId: { bsonType: 'string' },
          response: { bsonType: 'object' },
          createdAt: { bsonType: 'date' },
        },
      },
    },
  },

  secrets_metadata: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          ownerUserId: { bsonType: 'objectId' },
          alias: { bsonType: 'string' },
          scopeType: { bsonType: 'string' },
          scopeId: { bsonType: ['objectId', 'null'] },
          provider: { bsonType: ['string', 'null'] },
          status: { bsonType: 'string' },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' },
        },
      },
    },
  },
};

/**
 * Index definitions for performance optimization
 */
const INDEX_DEFINITIONS: Record<string, IndexSpec[]> = {
  users: [{ spec: { email: 1 }, options: { unique: true } }],
  llm_configs: [
    { spec: { userId: 1, provider: 1 }, options: { unique: true } },
    { spec: { userId: 1 }, options: {} },
  ],
  user_settings: [{ spec: { userId: 1 }, options: { unique: true } }],
  workflows: [
    { spec: { creator_id: 1 }, options: {} },
    { spec: { userId: 1 }, options: {} },
    { spec: { updatedAt: -1 }, options: {} },
  ],
  agents: [{ spec: { creator_id: 1 }, options: {} }],
  workflow_nodes: [{ spec: { workflowId: 1 }, options: {} }],
  workflow_edges: [{ spec: { workflowId: 1 }, options: {} }],
  agent_prototypes: [{ spec: { creator_id: 1 }, options: {} }],
  agent_instances: [
    { spec: { agentId: 1, createdAt: 1 }, options: {} },
    { spec: { workflowId: 1 }, options: {} },
  ],
  agent_templates: [
    { spec: { userId: 1, createdAt: -1 }, options: {} },
    { spec: { userId: 1, category: 1 }, options: {} },
    { spec: { userId: 1, isStarred: 1 }, options: {} },
  ],
  local_llm_profiles: [
    { spec: { userId: 1, name: 1 }, options: { unique: true } },
    { spec: { userId: 1 }, options: {} },
  ],
  workspaces: [
    { spec: { ownerUserId: 1, scopeType: 1, scopeId: 1 }, options: { unique: true, name: 'uq_workspace_owner_scope' } },
    { spec: { ownerUserId: 1, status: 1, updatedAt: -1 }, options: { name: 'idx_workspace_owner_status_updated' } },
  ],
  user_tools: [
    {
      spec: { scopeType: 1, name: 1 },
      options: {
        unique: true,
        partialFilterExpression: { scopeType: 'native', ownerUserId: null },
        name: 'uq_user_tools_native_name',
      },
    },
    {
      spec: { ownerUserId: 1, workflowId: 1, name: 1 },
      options: {
        unique: true,
        partialFilterExpression: { scopeType: 'user' },
        name: 'uq_user_tools_owner_workflow_name',
      },
    },
    {
      spec: { ownerUserId: 1, workflowId: 1, isEnabled: 1, status: 1, name: 1 },
      options: { name: 'idx_user_tools_owner_workflow_enabled_status_name' },
    },
    {
      spec: { workspaceId: 1, updatedAt: -1 },
      options: {
        partialFilterExpression: { workspaceId: { $type: 'objectId' } },
        name: 'idx_user_tools_workspace_updated',
      },
    },
  ],
  user_tool_runs: [
    { spec: { executionId: 1 }, options: { unique: true, name: 'uq_user_tool_runs_execution_id' } },
    { spec: { ownerUserId: 1, createdAt: -1 }, options: { name: 'idx_user_tool_runs_owner_created' } },
    {
      spec: { ownerUserId: 1, workflowId: 1, createdAt: -1 },
      options: {
        partialFilterExpression: { workflowId: { $type: 'objectId' } },
        name: 'idx_user_tool_runs_owner_workflow_created',
      },
    },
    { spec: { toolId: 1, createdAt: -1 }, options: { name: 'idx_user_tool_runs_tool_created' } },
    {
      spec: { ownerUserId: 1, status: 1, updatedAt: -1 },
      options: {
        partialFilterExpression: { status: { $in: ['queued', 'running'] } },
        name: 'idx_user_tool_runs_active_watchdog',
      },
    },
    {
      spec: { status: 1, 'timing.queuedAt': 1 },
      options: {
        partialFilterExpression: { status: 'queued' },
        name: 'idx_user_tool_runs_queued_dispatch',
      },
    },
    {
      spec: { status: 1, 'lease.expiresAt': 1 },
      options: {
        partialFilterExpression: { status: 'running', 'lease.expiresAt': { $type: 'date' } },
        name: 'idx_user_tool_runs_running_lease_expiry',
      },
    },
    {
      spec: { status: 1, cancellationRequestedAt: 1 },
      options: {
        partialFilterExpression: { status: 'running', cancellationRequestedAt: { $type: 'date' } },
        name: 'idx_user_tool_runs_cancellation_requests',
      },
    },
    {
      spec: { ownerUserId: 1, retryOfExecutionId: 1, createdAt: 1 },
      options: {
        partialFilterExpression: { retryOfExecutionId: { $type: 'string' } },
        name: 'idx_user_tool_runs_retry_lineage',
      },
    },
    {
      spec: { ownerUserId: 1, retryOfExecutionId: 1, recoveryAttemptCount: -1 },
      options: {
        partialFilterExpression: { retryOfExecutionId: { $type: 'string' } },
        name: 'idx_user_tool_runs_recovery_attempts',
      },
    },
    {
      spec: { status: 1, updatedAt: -1 },
      options: {
        partialFilterExpression: { status: { $in: ['worker_lost', 'quarantined'] } },
        name: 'idx_user_tool_runs_terminal_reconcilable',
      },
    },
  ],
  secrets_metadata: [
    {
      spec: { ownerUserId: 1, scopeType: 1, scopeId: 1, alias: 1 },
      options: { unique: true, name: 'uq_secrets_metadata_owner_scope_alias' },
    },
    { spec: { ownerUserId: 1, status: 1, updatedAt: -1 }, options: { name: 'idx_secrets_metadata_owner_status_updated' } },
  ],
  gateway_fence_audit: [
    { spec: { operationId: 1, timestamp: -1 }, options: { name: 'idx_gateway_fence_audit_operation' } },
    { spec: { runId: 1, timestamp: -1 }, options: { name: 'idx_gateway_fence_audit_run' } },
    { spec: { actorUserId: 1, timestamp: -1 }, options: { name: 'idx_gateway_fence_audit_actor' } },
  ],
  runtime_alerts: [
    {
      spec: { severity: 1, createdAt: -1 },
      options: {
        partialFilterExpression: { acknowledgedAt: null },
        name: 'idx_runtime_alerts_open_severity',
      },
    },
    { spec: { runId: 1, createdAt: -1 }, options: { name: 'idx_runtime_alerts_run' } },
  ],
  run_command_idempotency: [{ spec: { userId: 1, command: 1, createdAt: -1 }, options: { name: 'idx_run_command_idempotency_user' } }],
};

/**
 * Bootstrap phase: ensure collection schema, indexes, and development test accounts exist.
 * This is the base runtime initialization layer, intentionally separated from data migrations.
 */
export function resolveDevSeedUserConfig(): { email: string; password: string } | null {
  const email = (process.env.DEV_TEST_USER_EMAIL || 'test@example.com').trim();
  const password = (process.env.DEV_TEST_USER_PASSWORD || '').trim();

  if (!password) {
    return null;
  }

  return { email, password };
}

export async function runDatabaseBootstrap(db: mongoose.mongo.Db): Promise<void> {
  logger.info('🔧 Starting database bootstrap (Phase 1: schema and index check)...');

  const admin = db.admin();
  void admin;

  let currentDbCollections: mongoose.mongo.CollectionInfo[] = [];
  try {
    currentDbCollections = (await Promise.race([
      db.listCollections().toArray(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('listCollections timeout')), 5000)),
    ])) as mongoose.mongo.CollectionInfo[];
  } catch (timeoutError) {
    logger.warn('[Database] listCollections timeout - proceeding with empty collection list');
    currentDbCollections = [];
  }

  const existingCollectionNames = new Set(Array.isArray(currentDbCollections) ? currentDbCollections.map((c) => c.name) : []);
  const testUserExists = await db.collection('users').findOne({ email: 'test@example.com' });

  if (existingCollectionNames.size === 0) {
    logger.info('📋 Creating collections with schema validation...');
    await createCollectionsWithValidation(db);
    logger.info('✅ Collections created');

    logger.info('🗂️  Creating indexes for performance...');
    await createIndexes(db);
    logger.info('✅ Indexes created');

    logger.info('👤 Creating test user...');
    await createTestUser(db);
    logger.info('✅ Test user created');
  } else {
    logger.info(`✅ Database already initialized (${existingCollectionNames.size} collections found)`);

    const newCollectionNames = Object.keys(COLLECTION_SCHEMAS).filter((name) => !existingCollectionNames.has(name));

    if (newCollectionNames.length > 0) {
      logger.info(`🆕 Detected ${newCollectionNames.length} new collection(s) not in database`);
      await createNewCollections(db, existingCollectionNames);
      await createIndexesForNewCollections(db, newCollectionNames);
    }

    logger.info('🔄 Ensuring collection schemas are up to date...');
    await updateCollectionSchemas(db);
    await db.collection('user_tool_runs').createIndex(
      { status: 1, 'lease.expiresAt': 1 },
      {
        partialFilterExpression: { status: 'running', 'lease.expiresAt': { $type: 'date' } },
        name: 'idx_user_tool_runs_running_lease_expiry',
      },
    );

    // Index partiels US-J7-06 : recréés de façon idempotente sur une base existante.
    await db.collection('user_tool_runs').createIndex(
      { ownerUserId: 1, retryOfExecutionId: 1, recoveryAttemptCount: -1 },
      {
        partialFilterExpression: { retryOfExecutionId: { $type: 'string' } },
        name: 'idx_user_tool_runs_recovery_attempts',
      },
    );
    await db.collection('user_tool_runs').createIndex(
      { status: 1, updatedAt: -1 },
      {
        partialFilterExpression: { status: { $in: ['worker_lost', 'quarantined'] } },
        name: 'idx_user_tool_runs_terminal_reconcilable',
      },
    );

    if (!testUserExists && process.env.NODE_ENV === 'development') {
      logger.info('👤 Injecting test user...');
      await createTestUser(db);
      logger.info('✅ Test user injected');
    }

    try {
      await verifyIndexes(db);
      logger.info('✅ Indexes verified');
    } catch (indexError) {
      logger.warn('⚠️  Index verification warning (non-blocking):', indexError instanceof Error ? indexError.message : String(indexError));
    }
  }
}

/**
 * Migration phase: data backfills and schema evolution tasks that must be run explicitly.
 */
export async function runDatabaseMigrations(db: mongoose.mongo.Db): Promise<void> {
  logger.info('🧩 Starting database migrations (Phase 2: data backfills and compatibility updates)...');
  await runMediaReferenceCatalogBackfill(db);

  try {
    const summary = await migrateLegacyWorkflowGraphsToV2(db);
    logger.info(
      `🧩 Workflow V1 -> V2 migration: scanned=${summary.workflowsScanned} migrated=${summary.workflowsMigrated} nodesCreated=${summary.nodesCreated} edgesCreated=${summary.edgesCreated} duplicatesPrevented=${summary.duplicatesPrevented}`,
    );
  } catch (error) {
    logger.warn('⚠️  workflow V1 -> V2 migration warning:', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Seed phase: canonical runtime tools and local examples for the current environment.
 */
export async function runSeedPhase(db: mongoose.mongo.Db): Promise<void> {
  logger.info('🌱 Starting database seed phase (Phase 3: runtime seeders)...');
  await seedNativeFunctions(db);
  await seedSharedExampleFunctions(db);
  await provisionNativePythonToolsOnStartup();
}

/**
 * Main initialization function
 * Idempotent: Checks if collections exist before creating
 */
export async function initializeDatabase(): Promise<void> {
  try {
    if (!mongoose.connection.db) {
      logger.warn('🔌 MongoDB not connected yet, skipping database initialization');
      return;
    }

    const db = mongoose.connection.db;
    await runDatabaseBootstrap(db);
    await runDatabaseMigrations(db);
    await runSeedPhase(db);

    logger.info('🎯 Database initialization complete!');
  } catch (error) {
    logger.error('💀 Database initialization error:', error instanceof Error ? error.message : String(error));
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
  }
}

export async function runMediaReferenceCatalogBackfill(db: mongoose.mongo.Db): Promise<void> {
  try {
    const summary = await backfillMediaReferenceCatalogFields(db);

    if (!summary.collectionFound) {
      logger.debug('  • media_references absent, backfill catalogue media ignoré');
      return;
    }

    logger.info(
      `🧩 Media catalog backfill: scanned=${summary.scanned} updated=${summary.updated} compatible=${summary.alreadyCompatible} blocked=${summary.blocked}`,
    );
  } catch (error) {
    logger.warn('⚠️  media catalog backfill warning:', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Update validation schemas for existing collections
 * This ensures the database stays in sync with code changes
 */
async function updateCollectionSchemas(db: mongoose.mongo.Db): Promise<void> {
  for (const [collectionName, schema] of Object.entries(COLLECTION_SCHEMAS)) {
    try {
      if (schema.validator) {
        await db.command({
          collMod: collectionName,
          validator: schema.validator,
        });
        logger.debug(`  ✓ Updated schema for ${collectionName}`);
      }
    } catch (error: unknown) {
      logger.warn(`  ⚠️ Could not update schema for ${collectionName}:`, errorMessageOf(error));
    }
  }
}

/**
 * Create collections with JSON Schema validation
 */
async function createCollectionsWithValidation(db: mongoose.mongo.Db): Promise<void> {
  for (const [collectionName, schema] of Object.entries(COLLECTION_SCHEMAS)) {
    try {
      if (schema.validator) {
        await db.createCollection(collectionName, { validator: schema.validator });
      } else {
        await db.createCollection(collectionName);
      }
      logger.debug(`  ✓ ${collectionName}`);
    } catch (error: unknown) {
      if (asErrorShape(error).code === 48) {
        // Collection already exists - this is fine
        logger.debug(`  ✓ ${collectionName} (already exists)`);
      } else {
        throw error;
      }
    }
  }
}

/**
 * Create indexes for query performance
 */
async function createIndexes(db: mongoose.mongo.Db): Promise<void> {
  for (const [collectionName, indexes] of Object.entries(INDEX_DEFINITIONS)) {
    const collection = db.collection(collectionName);
    for (const index of indexes) {
      try {
        await collection.createIndex(index.spec, index.options);
        logger.debug(`  ✓ ${collectionName}: ${JSON.stringify(index.spec)}`);
      } catch (error: unknown) {
        if (asErrorShape(error).code === 85) {
          // Index already exists with different options
          logger.debug(`  ✓ ${collectionName}: ${JSON.stringify(index.spec)} (already exists)`);
        } else {
          throw error;
        }
      }
    }
  }
}

/**
 * Verify indexes exist (for monitoring during startup)
 */
async function verifyIndexes(db: mongoose.mongo.Db): Promise<void> {
  for (const collectionName of Object.keys(INDEX_DEFINITIONS)) {
    try {
      const collection = db.collection(collectionName);
      const indexes = await collection.listIndexes().toArray();
      logger.debug(`  ${collectionName}: ${indexes.length} index(es)`);
    } catch (error) {
      // Non-critical: Just log
      logger.debug(`  ${collectionName}: Could not verify indexes`);
    }
  }
}

/**
 * Create a development seed user for local testing
 * Email: test@example.com
 *
 * SECURITY NOTE:
 * - Only created in development mode
 * - Password is stored only as a bcrypt hash
 * - This user is for testing purposes only
 */
async function createTestUser(db: mongoose.mongo.Db): Promise<void> {
  try {
    const devSeedUser = resolveDevSeedUserConfig();
    if (!devSeedUser) {
      logger.warn('  ⚠️ Skipping development seed user: set DEV_TEST_USER_PASSWORD to enable a local test account.');
      return;
    }

    const collection = db.collection('users');
    const existingUser = await collection.findOne({ email: devSeedUser.email });

    if (existingUser) {
      logger.info('  Test user already exists');
      return;
    }

    const hashedPassword = await bcrypt.hash(devSeedUser.password, 12);
    const testUser = {
      email: devSeedUser.email,
      password: hashedPassword,
      role: 'user',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await collection.insertOne(testUser);
    logger.info(`  ✓ Test user created: ${devSeedUser.email}`);
  } catch (error: unknown) {
    if (isDuplicateKeyError(error) && (error as { keyPattern?: Record<string, unknown> }).keyPattern?.email) {
      // Duplicate key on email - this is fine
      logger.debug('  Test user email already exists (idempotent)');
    } else {
      throw error;
    }
  }
}

/**
 * Detect and create NEW collections (not present in database)
 * This allows adding new collections after the initial database setup
 * without requiring a database reset or manual schema creation
 */
async function createNewCollections(db: mongoose.mongo.Db, existingNames: Set<string>): Promise<void> {
  const newCollections = Object.keys(COLLECTION_SCHEMAS).filter((name) => !existingNames.has(name));

  if (newCollections.length === 0) {
    logger.debug('  No new collections to create');
    return;
  }

  logger.info(`📋 Creating ${newCollections.length} new collection(s) with schema validation...`);

  for (const collectionName of newCollections) {
    try {
      const schema = COLLECTION_SCHEMAS[collectionName];
      if (schema.validator) {
        await db.createCollection(collectionName, { validator: schema.validator });
      } else {
        await db.createCollection(collectionName);
      }
      logger.debug(`  ✓ ${collectionName}`);
    } catch (error: unknown) {
      if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 48) {
        throw error;
      }
      logger.debug(`  ✓ ${collectionName} (created concurrently; schema will be updated)`);
    }
  }

  logger.info('✅ New collections created');
}

/**
 * Create indexes for NEW collections only
 * Existing collections' indexes are handled separately by verifyIndexes
 * This ensures indexes are created immediately when new collections are added
 */
async function createIndexesForNewCollections(db: mongoose.mongo.Db, newCollectionNames: string[]): Promise<void> {
  if (newCollectionNames.length === 0) {
    return;
  }

  logger.info('🗂️  Creating indexes for new collection(s)...');

  for (const collectionName of newCollectionNames) {
    const indexes = INDEX_DEFINITIONS[collectionName];
    if (!indexes) continue;

    const collection = db.collection(collectionName);
    for (const index of indexes) {
      try {
        await collection.createIndex(index.spec, index.options);
        logger.debug(`  ✓ ${collectionName}: ${JSON.stringify(index.spec)}`);
      } catch (error: unknown) {
        if (asErrorShape(error).code !== 85) {
          // 85 = index already exists
          throw error;
        }
      }
    }
  }

  logger.info('✅ Indexes created for new collections');
}

async function upsertCanonicalSeedTool(
  userToolsCol: mongoose.mongo.Collection,
  filter: Record<string, unknown>,
  legacySeed: LegacyFunctionLike,
  overrides?: Record<string, unknown>,
): Promise<{ upsertedCount: number; modifiedCount: number }> {
  const existingTool = await userToolsCol.findOne(filter, {
    projection: {
      currentVersion: 1,
      versions: 1,
    },
  });

  const mappedFields = {
    // existingTool vient de Mongo (WithId<Document>) : cast structurel vers la forme attendue par le mapper
    ...mapLegacyFunctionToUserToolFields(legacySeed, existingTool as Parameters<typeof mapLegacyFunctionToUserToolFields>[1]),
    ...overrides,
  };

  const result = await userToolsCol.updateOne(
    filter,
    {
      $set: mappedFields,
      $setOnInsert: {
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );

  return {
    upsertedCount: result.upsertedCount ?? 0,
    modifiedCount: result.modifiedCount ?? 0,
  };
}

/**
 * Seed des 11 fonctions natives directement dans user_tools.
 * Idempotent : upsert par (scopeType:native, ownerUserId:null, name).
 */
export async function seedNativeFunctions(db: mongoose.mongo.Db): Promise<void> {
  try {
    const userToolsCol = db.collection('user_tools');
    let upserted = 0;
    let updated = 0;

    for (const fn of nativeFunctionsSeed) {
      const result = await upsertCanonicalSeedTool(userToolsCol, { name: fn.name, ownerUserId: null, scopeType: 'native' }, fn);
      if (result.upsertedCount > 0) upserted++;
      else if (result.modifiedCount > 0) updated++;
    }

    if (upserted > 0) {
      logger.info(`🌱 ${upserted} outil(s) natif(s) seedé(s) dans user_tools`);
    } else if (updated > 0) {
      logger.info(`🔁 ${updated} outil(s) natif(s) mis à jour dans user_tools`);
    } else {
      logger.debug('  ✓ Outils natifs déjà convergents dans user_tools');
    }
  } catch (err) {
    // Non-bloquant : log mais ne crashe pas le démarrage
    logger.warn('⚠️  seedNativeFunctions warning:', err instanceof Error ? err.message : String(err));
  }
}

export async function seedSharedExampleFunctions(db: mongoose.mongo.Db): Promise<void> {
  try {
    const userToolsCol = db.collection('user_tools');
    const helloTestInline = `// Exemple de fonction TypeScript partagée\nexport function run(\n  context: { userId: string; agentId?: string; workflowId?: string; depth: number },\n  args: { user_name?: string; name?: string }\n): unknown {\n  // Compatibilité transitoire: accepte encore args.name pour les anciens prompts déjà persistés.\n  const legacyName = typeof args.name === "string" && args.name.trim().length > 0\n    ? args.name.trim()\n    : null;\n\n  const userName = typeof args.user_name === "string" && args.user_name.trim().length > 0\n    ? args.user_name.trim()\n    : legacyName ?? "inconnu";\n\n  return { result: \`Ton nom, ${'${'}userName}, est maintenant enregistré dans ma mémoire\` };\n}\n`;

    const staleToolMirrors = await userToolsCol.deleteMany({
      name: SHARED_HELLO_TEST_TOOL_NAME,
      $or: [{ ownerUserId: { $ne: null } }, { isReadonly: { $ne: true } }],
    });

    if (staleToolMirrors.deletedCount > 0) {
      logger.info(`🧹 Nettoyage hello_test: ${staleToolMirrors.deletedCount} miroir(s) orphelin(s) user_tools supprimé(s)`);
    }

    const result = await upsertCanonicalSeedTool(
      userToolsCol,
      { name: SHARED_HELLO_TEST_TOOL_NAME, ownerUserId: null, scopeType: 'user' },
      {
        name: SHARED_HELLO_TEST_TOOL_NAME,
        description:
          "Exemple TypeScript partagé. Appelle cette fonction quand l'utilisateur se présente, donne son prénom ou son nom, ou demande d'enregistrer son nom. Extrais ce nom dans args.user_name puis laisse l'outil confirmer l'enregistrement.",
        language: 'typescript',
        origin: 'custom',
        userId: null,
        workflowId: null,
        inputSchema: {
          type: 'object',
          required: ['user_name'],
          properties: {
            user_name: {
              type: 'string',
              description: "Nom ou prénom fourni par l'utilisateur au moment où il se présente.",
              example: 'Syl',
            },
          },
        },
        outputSchema: {
          type: 'object',
          properties: {
            result: {
              type: 'string',
              description: "Confirmation textuelle retournée à l'utilisateur.",
              example: 'Ton nom, Syl, est maintenant enregistré dans ma mémoire',
            },
          },
        },
        codeInline: helloTestInline,
        codePath: null,
        dependencies: { python: [], npm: [] },
        isEnabled: true,
        isReadonly: true,
        version: 3,
        tags: ['example', 'shared', 'typescript'],
      },
      {
        trustLevel: 'internal',
      },
    );

    if (result.upsertedCount > 0) {
      logger.info('🌱 Exemple partagé hello_test seedé dans user_tools');
    } else if (result.modifiedCount > 0) {
      logger.info('🔁 Exemple partagé hello_test mis à jour dans user_tools');
    } else {
      logger.debug('  ✓ Exemple partagé hello_test déjà convergent');
    }
  } catch (err) {
    logger.warn('⚠️  seedSharedExampleFunctions warning:', err instanceof Error ? err.message : String(err));
  }
}

async function provisionNativePythonToolsOnStartup(): Promise<void> {
  try {
    const summary = await nativePythonProvisioningService.provisionPendingNativeToolsOnStartup();

    if (summary.attempted === 0) {
      return;
    }

    logger.info(
      `🐍 native python provisioning startup: attempted=${summary.attempted} succeeded=${summary.succeeded} failed=${summary.failed} skipped=${summary.skipped}`,
    );
  } catch (err) {
    logger.warn('⚠️  native python provisioning startup warning:', err instanceof Error ? err.message : String(err));
  }
}

export default { initializeDatabase };
