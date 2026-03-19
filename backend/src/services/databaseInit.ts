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

import mongoose from 'mongoose';
import { nativeFunctionsSeed } from '../seeds/nativeFunctions.seed';
import {
  getRepairOnlyProtectedFields,
  getUserToolStartupSyncPhase,
  syncUserToolsFromLegacyFunctionsOnStartup
} from './userToolStartupSync.service';

/**
 * Define MongoDB collection schemas with validation rules
 * IMPORTANT: Schemas are PERMISSIVE (not restrictive)
 * - Mongoose models handle strict validation
 * - MongoDB schemas only enforce document structure basics
 * - additionalProperties: true allows flexible fields
 * - No 'required' arrays to allow partial documents during operations
 */
const COLLECTION_SCHEMAS = {
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
          updatedAt: { bsonType: 'date' }
        }
      }
    }
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
          updatedAt: { bsonType: 'date' }
        }
      }
    }
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
          updatedAt: { bsonType: 'date' }
        }
      }
    }
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
          lastSavedAt: { bsonType: 'date' }
        }
      }
    }
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
          updatedAt: { bsonType: 'date' }
        }
      }
    }
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
          position: { bsonType: 'object' }
        }
      }
    }
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
          target: { bsonType: 'string' }
        }
      }
    }
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
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' }
        }
      }
    }
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
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' }
        }
      }
    }
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
          updatedAt: { bsonType: 'date' }
        }
      }
    }
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
          updatedAt: { bsonType: 'date' }
        }
      }
    }
  },

  user_functions: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: true,
        properties: {
          _id: { bsonType: 'objectId' },
          name: { bsonType: 'string' },
          description: { bsonType: 'string' },
          language: { bsonType: 'string' },
          origin: { bsonType: 'string' },
          userId: { bsonType: ['objectId', 'null'] },
          workflowId: { bsonType: ['objectId', 'null'] },
          isEnabled: { bsonType: 'bool' },
          isReadonly: { bsonType: 'bool' },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' }
        }
      }
    }
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
          updatedAt: { bsonType: 'date' }
        }
      }
    }
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
          updatedAt: { bsonType: 'date' }
        }
      }
    }
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
          launchContext: { bsonType: 'string' },
          status: { bsonType: 'string' },
          runtime: { bsonType: 'string' },
          runner: { bsonType: 'string' },
          inputs: { bsonType: 'object' },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' }
        }
      }
    }
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
          updatedAt: { bsonType: 'date' }
        }
      }
    }
  }
};

/**
 * Index definitions for performance optimization
 */
const INDEX_DEFINITIONS = {
  users: [
    { spec: { email: 1 }, options: { unique: true } }
  ],
  llm_configs: [
    { spec: { userId: 1, provider: 1 }, options: { unique: true } },
    { spec: { userId: 1 }, options: {} }
  ],
  user_settings: [
    { spec: { userId: 1 }, options: { unique: true } }
  ],
  workflows: [
    { spec: { creator_id: 1 }, options: {} },
    { spec: { userId: 1 }, options: {} },
    { spec: { updatedAt: -1 }, options: {} }
  ],
  agents: [
    { spec: { creator_id: 1 }, options: {} }
  ],
  workflow_nodes: [
    { spec: { workflowId: 1 }, options: {} }
  ],
  workflow_edges: [
    { spec: { workflowId: 1 }, options: {} }
  ],
  agent_prototypes: [
    { spec: { creator_id: 1 }, options: {} }
  ],
  agent_instances: [
    { spec: { agentId: 1, createdAt: 1 }, options: {} },
    { spec: { workflowId: 1 }, options: {} }
  ],
  agent_templates: [
    { spec: { userId: 1, createdAt: -1 }, options: {} },
    { spec: { userId: 1, category: 1 }, options: {} },
    { spec: { userId: 1, isStarred: 1 }, options: {} }
  ],
  local_llm_profiles: [
    { spec: { userId: 1, name: 1 }, options: { unique: true } },
    { spec: { userId: 1 }, options: {} }
  ],
  user_functions: [
    { spec: { userId: 1, workflowId: 1, isEnabled: 1 }, options: { name: 'idx_user_workflow_enabled' } },
    { spec: { origin: 1, isEnabled: 1 }, options: { name: 'idx_origin_enabled' } },
    { spec: { name: 1, userId: 1 }, options: { unique: true, sparse: false, name: 'idx_name_user_unique' } }
  ],
  workspaces: [
    { spec: { ownerUserId: 1, scopeType: 1, scopeId: 1 }, options: { unique: true, name: 'uq_workspace_owner_scope' } },
    { spec: { ownerUserId: 1, status: 1, updatedAt: -1 }, options: { name: 'idx_workspace_owner_status_updated' } }
  ],
  user_tools: [
    {
      spec: { scopeType: 1, name: 1 },
      options: {
        unique: true,
        partialFilterExpression: { scopeType: 'native', ownerUserId: null },
        name: 'uq_user_tools_native_name'
      }
    },
    {
      spec: { ownerUserId: 1, workflowId: 1, name: 1 },
      options: {
        unique: true,
        partialFilterExpression: { scopeType: 'user' },
        name: 'uq_user_tools_owner_workflow_name'
      }
    },
    {
      spec: { ownerUserId: 1, workflowId: 1, isEnabled: 1, status: 1, name: 1 },
      options: { name: 'idx_user_tools_owner_workflow_enabled_status_name' }
    },
    {
      spec: { workspaceId: 1, updatedAt: -1 },
      options: {
        partialFilterExpression: { workspaceId: { $type: 'objectId' } },
        name: 'idx_user_tools_workspace_updated'
      }
    }
  ],
  user_tool_runs: [
    { spec: { executionId: 1 }, options: { unique: true, name: 'uq_user_tool_runs_execution_id' } },
    { spec: { ownerUserId: 1, createdAt: -1 }, options: { name: 'idx_user_tool_runs_owner_created' } },
    {
      spec: { ownerUserId: 1, workflowId: 1, createdAt: -1 },
      options: {
        partialFilterExpression: { workflowId: { $type: 'objectId' } },
        name: 'idx_user_tool_runs_owner_workflow_created'
      }
    },
    { spec: { toolId: 1, createdAt: -1 }, options: { name: 'idx_user_tool_runs_tool_created' } },
    {
      spec: { ownerUserId: 1, status: 1, updatedAt: -1 },
      options: {
        partialFilterExpression: { status: { $in: ['queued', 'running'] } },
        name: 'idx_user_tool_runs_active_watchdog'
      }
    }
  ],
  secrets_metadata: [
    {
      spec: { ownerUserId: 1, scopeType: 1, scopeId: 1, alias: 1 },
      options: { unique: true, name: 'uq_secrets_metadata_owner_scope_alias' }
    },
    { spec: { ownerUserId: 1, status: 1, updatedAt: -1 }, options: { name: 'idx_secrets_metadata_owner_status_updated' } }
  ]
};

/**
 * Main initialization function
 * Idempotent: Checks if collections exist before creating
 */
export async function initializeDatabase(): Promise<void> {
  try {
    if (!mongoose.connection.db) {
      console.warn('🔌 MongoDB not connected yet, skipping database initialization');
      return;
    }

    const db = mongoose.connection.db;
    console.info('🔧 Starting database initialization (Phase 1: Check)...');

    // PHASE 1: Check existing collections and test user
    // NOTE: Use native MongoDB client, not Mongoose connection to avoid blocking
    const admin = db.admin();
    
    // Get current database collections with timeout protection
    let currentDbCollections: any[] = [];
    try {
      currentDbCollections = await Promise.race([
        db.listCollections().toArray(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('listCollections timeout')), 5000))
      ]) as any[];
    } catch (timeoutError) {
      console.warn('[Database] listCollections timeout - proceeding with empty collection list');
      currentDbCollections = [];
    }
    
    const existingCollectionNames = new Set(
      Array.isArray(currentDbCollections) ? currentDbCollections.map((c: any) => c.name) : []
    );
    const testUserExists = await db.collection('users').findOne({ email: 'test@example.com' });

    // PHASE 2: Create only if absent
    if (existingCollectionNames.size === 0) {
      console.info('📋 Creating collections with schema validation...');
      await createCollectionsWithValidation(db);
      console.info('✅ Collections created');

      console.info('🗂️  Creating indexes for performance...');
      await createIndexes(db);
      console.info('✅ Indexes created');

      console.info('👤 Creating test user...');
      await createTestUser(db);
      console.info('✅ Test user created');
    } else {
      // Existing collections found
      console.info(`✅ Database already initialized (${existingCollectionNames.size} collections found)`);
      
      // CRITICAL FIX: Detect NEW collections added to COLLECTION_SCHEMAS
      // This allows adding new collections after database initialization
      const newCollectionNames = Object.keys(COLLECTION_SCHEMAS)
        .filter(name => !existingCollectionNames.has(name));

      if (newCollectionNames.length > 0) {
        console.info(`🆕 Detected ${newCollectionNames.length} new collection(s) not in database`);
        await createNewCollections(db, existingCollectionNames);
        await createIndexesForNewCollections(db, newCollectionNames);
      }
      
      // Self-healing: Update schemas to ensure they match current code
      console.info('🔄 Ensuring collection schemas are up to date...');
      await updateCollectionSchemas(db);

      if (!testUserExists && process.env.NODE_ENV === 'development') {
        console.info('👤 Injecting test user...');
        await createTestUser(db);
        console.info('✅ Test user injected');
      }

      try {
        await verifyIndexes(db);
        console.info('✅ Indexes verified');
      } catch (indexError) {
        console.warn('⚠️  Index verification warning (non-blocking):', 
          indexError instanceof Error ? indexError.message : String(indexError));
      }
    }

    // ─── Toujours seeder les fonctions natives (idempotent) ───────────────
    await seedNativeFunctions(db);
    await syncUserToolsFromLegacyFunctions(db);

    console.info('🎯 Database initialization complete!');
  } catch (error) {
    console.error('💀 Database initialization error:', 
      error instanceof Error ? error.message : String(error));
    // Non-blocking: Log but don't crash startup
    if (process.env.NODE_ENV === 'production') {
      throw error; // In production, fail fast
    }
  }
}

/**
 * Update validation schemas for existing collections
 * This ensures the database stays in sync with code changes
 */
async function updateCollectionSchemas(db: any): Promise<void> {
  for (const [collectionName, schema] of Object.entries(COLLECTION_SCHEMAS)) {
    try {
      if (schema.validator) {
        await db.command({
          collMod: collectionName,
          validator: schema.validator
        });
        console.debug(`  ✓ Updated schema for ${collectionName}`);
      }
    } catch (error: any) {
      console.warn(`  ⚠️ Could not update schema for ${collectionName}:`, error.message);
    }
  }
}

/**
 * Create collections with JSON Schema validation
 */
async function createCollectionsWithValidation(db: any): Promise<void> {
  for (const [collectionName, schema] of Object.entries(COLLECTION_SCHEMAS)) {
    try {
      if (schema.validator) {
        await db.createCollection(collectionName, { validator: schema.validator });
      } else {
        await db.createCollection(collectionName);
      }
      console.debug(`  ✓ ${collectionName}`);
    } catch (error: any) {
      if (error.code === 48) {
        // Collection already exists - this is fine
        console.debug(`  ✓ ${collectionName} (already exists)`);
      } else {
        throw error;
      }
    }
  }
}

/**
 * Create indexes for query performance
 */
async function createIndexes(db: any): Promise<void> {
  for (const [collectionName, indexes] of Object.entries(INDEX_DEFINITIONS)) {
    const collection = db.collection(collectionName);
    for (const index of indexes as any[]) {
      try {
        await collection.createIndex(index.spec, index.options);
        console.debug(`  ✓ ${collectionName}: ${JSON.stringify(index.spec)}`);
      } catch (error: any) {
        if (error.code === 85) {
          // Index already exists with different options
          console.debug(`  ✓ ${collectionName}: ${JSON.stringify(index.spec)} (already exists)`);
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
async function verifyIndexes(db: any): Promise<void> {
  for (const collectionName of Object.keys(INDEX_DEFINITIONS)) {
    try {
      const collection = db.collection(collectionName);
      const indexes = await collection.listIndexes().toArray();
      console.debug(`  ${collectionName}: ${indexes.length} index(es)`);
    } catch (error) {
      // Non-critical: Just log
      console.debug(`  ${collectionName}: Could not verify indexes`);
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
async function createTestUser(db: any): Promise<void> {
  try {
    const collection = db.collection('users');
    const existingUser = await collection.findOne({ email: 'test@example.com' });

    if (existingUser) {
      console.info('  Test user already exists');
      return;
    }

    // Static bcrypt hash used only for the local development seed account
    const hashedPassword = '$2b$10$JkttyuwNvLIxq.f2p9rW8uKD7CFyZZvPZP8jKgRPrBXf2wq8Z2j6u';

    const testUser = {
      email: 'test@example.com',
      password: hashedPassword,
      role: 'user',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await collection.insertOne(testUser);
    console.info('  ✓ Test user created:');
    console.info('    Email: test@example.com');
  } catch (error: any) {
    if (error.code === 11000 && error.keyPattern?.email) {
      // Duplicate key on email - this is fine
      console.debug('  Test user email already exists (idempotent)');
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
async function createNewCollections(db: any, existingNames: Set<string>): Promise<void> {
  const newCollections = Object.keys(COLLECTION_SCHEMAS)
    .filter(name => !existingNames.has(name));

  if (newCollections.length === 0) {
    console.debug('  No new collections to create');
    return;
  }

  console.info(`📋 Creating ${newCollections.length} new collection(s) with schema validation...`);
  
  for (const collectionName of newCollections) {
    try {
      const schema = (COLLECTION_SCHEMAS as any)[collectionName];
      if (schema.validator) {
        await db.createCollection(collectionName, { validator: schema.validator });
      } else {
        await db.createCollection(collectionName);
      }
      console.debug(`  ✓ ${collectionName}`);
    } catch (error: any) {
      throw error;  // Treat as error - should not happen for new collections
    }
  }
  
  console.info('✅ New collections created');
}

/**
 * Create indexes for NEW collections only
 * Existing collections' indexes are handled separately by verifyIndexes
 * This ensures indexes are created immediately when new collections are added
 */
async function createIndexesForNewCollections(
  db: any,
  newCollectionNames: string[]
): Promise<void> {
  if (newCollectionNames.length === 0) {
    return;
  }

  console.info('🗂️  Creating indexes for new collection(s)...');
  
  for (const collectionName of newCollectionNames) {
    const indexes = (INDEX_DEFINITIONS as any)[collectionName];
    if (!indexes) continue;

    const collection = db.collection(collectionName);
    for (const index of indexes as any[]) {
      try {
        await collection.createIndex(index.spec, index.options);
        console.debug(`  ✓ ${collectionName}: ${JSON.stringify(index.spec)}`);
      } catch (error: any) {
        if (error.code !== 85) {  // 85 = index already exists
          throw error;
        }
      }
    }
  }
  
  console.info('✅ Indexes created for new collections');
}

/**
 * Seed des 11 fonctions natives dans user_functions.
 * Idempotent : utilise upsert sur (name, userId:null) pour ne jamais dupliquer.
 * Appelée à chaque démarrage du serveur.
 */
async function seedNativeFunctions(db: any): Promise<void> {
  try {
    const col = db.collection('user_functions');
    let upserted = 0;
    for (const fn of nativeFunctionsSeed) {
      const result = await col.updateOne(
        { name: fn.name, userId: null },
        {
          // Corrige la version (number) sur les docs existants seedés avec l'ancienne string '1.0.0'
          $set: { version: fn.version },
          $setOnInsert: { ...fn, createdAt: new Date(), updatedAt: new Date() }
        },
        { upsert: true }
      );
      if (result.upsertedCount > 0) upserted++;
    }
    if (upserted > 0) {
      console.info(`🌱 ${upserted} fonction(s) native(s) seedée(s) dans user_functions`);
    } else {
      console.debug('  ✓ Fonctions natives déjà présentes (aucun upsert nécessaire)');
    }
  } catch (err) {
    // Non-bloquant : log mais ne crashe pas le démarrage
    console.warn('⚠️  seedNativeFunctions warning:', err instanceof Error ? err.message : String(err));
  }
}

async function syncUserToolsFromLegacyFunctions(db: any): Promise<void> {
  try {
    const phase = getUserToolStartupSyncPhase();
    const summary = await syncUserToolsFromLegacyFunctionsOnStartup(db);

    if (summary.created > 0 || summary.updated > 0) {
      console.info(
        `🔁 startup sync user_functions -> user_tools [${summary.phase}] scanned=${summary.scanned} created=${summary.created} updated=${summary.updated} skipped=${summary.skippedExisting}`
      );
    } else {
      console.debug(
        `  ✓ startup sync user_tools déjà convergent [${summary.phase}] scanned=${summary.scanned} skipped=${summary.skippedExisting}`
      );
    }

    if (phase === 'repair-only') {
      console.info(
        `🛡️ startup sync repair-only protège les champs cibles: ${getRepairOnlyProtectedFields().join(', ')}`
      );
    }
  } catch (err) {
    console.warn('⚠️  syncUserToolsFromLegacyFunctions warning:', err instanceof Error ? err.message : String(err));
  }
}

export default { initializeDatabase };
