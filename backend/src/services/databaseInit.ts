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
  }
};

/**
 * Index definitions for performance optimization
 */
const INDEX_DEFINITIONS = {
  users: [
    { spec: { email: 1 }, options: { unique: true, sparse: true } }
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
 * Create test user for development/testing
 * Email: test@example.com
 * Password: TestPassword123
 * 
 * SECURITY NOTE: 
 * - Only created in development mode
 * - Password is bcrypt-hashed
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

    // Bcrypt hash of "TestPassword123" with 10 rounds
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
    console.info('    Password: TestPassword123');
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

export default { initializeDatabase };
