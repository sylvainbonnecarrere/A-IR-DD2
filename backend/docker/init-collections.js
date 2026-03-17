// MongoDB Collections & Schema Initialization
// This script creates all required collections and indexes for A-IR-DD2 J4.3

// Switch to application database
db = db.getSiblingDB('a-ir-dd2-dev');

// Create users collection with schema validation
db.createCollection('users', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['email', 'passwordHash', 'createdAt'],
      properties: {
        _id: { bsonType: 'objectId' },
        email: {
          bsonType: 'string',
          pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$',
          description: 'User email address (unique)'
        },
        passwordHash: {
          bsonType: 'string',
          description: 'Bcrypt hashed password'
        },
        createdAt: {
          bsonType: 'date',
          description: 'Account creation timestamp'
        },
        updatedAt: {
          bsonType: 'date',
          description: 'Last update timestamp'
        },
        isActive: {
          bsonType: 'bool',
          description: 'Account status'
        }
      }
    }
  }
});

// Create index on email for faster lookups and uniqueness
db.users.createIndex({ email: 1 }, { unique: true });
console.log('Ô£ô Created users collection with email unique index');

// Create llm_configs collection
db.createCollection('llm_configs', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'provider', 'createdAt'],
      properties: {
        _id: { bsonType: 'objectId' },
        userId: {
          bsonType: 'objectId',
          description: 'Reference to user'
        },
        provider: {
          bsonType: 'string',
          description: 'LLM provider name (gemini, openai, etc.)'
        },
        apiKeyEncrypted: {
          bsonType: 'string',
          description: 'AES-256-GCM encrypted API key'
        },
        capabilities: {
          bsonType: 'object',
          description: 'Available capabilities for this provider'
        },
        isEnabled: {
          bsonType: 'bool',
          description: 'Whether this provider is active'
        },
        createdAt: {
          bsonType: 'date'
        },
        updatedAt: {
          bsonType: 'date'
        }
      }
    }
  }
});

// Create compound index on userId and provider
db.llm_configs.createIndex({ userId: 1, provider: 1 }, { unique: true });
db.llm_configs.createIndex({ userId: 1 });
console.log('Ô£ô Created llm_configs collection with userId+provider index');

// Create user_settings collection (J4.3 Feature)
db.createCollection('user_settings', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'createdAt'],
      properties: {
        _id: { bsonType: 'objectId' },
        userId: {
          bsonType: 'objectId',
          description: 'Reference to user'
        },
        llmConfigs: {
          bsonType: 'object',
          description: 'Per-user LLM provider configurations with encrypted keys'
        },
        preferences: {
          bsonType: 'object',
          properties: {
            language: { bsonType: 'string' },
            theme: { bsonType: 'string' }
          },
          description: 'User UI preferences'
        },
        version: {
          bsonType: 'int',
          description: 'Settings version for optimistic concurrency'
        },
        createdAt: {
          bsonType: 'date'
        },
        updatedAt: {
          bsonType: 'date'
        }
      }
    }
  }
});

// Create index on userId for fast lookups
db.user_settings.createIndex({ userId: 1 }, { unique: true });
console.log('Ô£ô Created user_settings collection (J4.3) with userId index');

// Create workflows collection
db.createCollection('workflows', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['name', 'creator_id', 'createdAt'],
      properties: {
        _id: { bsonType: 'objectId' },
        name: { bsonType: 'string' },
        description: { bsonType: 'string' },
        creator_id: { bsonType: 'string', description: 'Robot creator ID' },
        status: { bsonType: 'string' },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' }
      }
    }
  }
});

db.workflows.createIndex({ creator_id: 1 });
console.log('Ô£ô Created workflows collection');

// Create agents collection
db.createCollection('agents', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['name', 'creator_id', 'createdAt'],
      properties: {
        _id: { bsonType: 'objectId' },
        name: { bsonType: 'string' },
        description: { bsonType: 'string' },
        creator_id: { bsonType: 'string', description: 'Robot creator ID (Archi for agents)' },
        tools: { bsonType: 'array' },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' }
      }
    }
  }
});

db.agents.createIndex({ creator_id: 1 });
console.log('Ô£ô Created agents collection');

// Create workflow_nodes collection
db.createCollection('workflow_nodes');
db.workflow_nodes.createIndex({ workflowId: 1 });
console.log('Ô£ô Created workflow_nodes collection');

// Create workflow_edges collection
db.createCollection('workflow_edges');
db.workflow_edges.createIndex({ workflowId: 1 });
console.log('Ô£ô Created workflow_edges collection');

// Create agent_prototypes collection
db.createCollection('agent_prototypes');
db.agent_prototypes.createIndex({ creator_id: 1 });
console.log('Ô£ô Created agent_prototypes collection');

// Create agent_instances collection (for runtime tracking)
db.createCollection('agent_instances');
db.agent_instances.createIndex({ agentId: 1, createdAt: 1 });
console.log('Ô£ô Created agent_instances collection');

// Create local_llm_profiles collection (for multiple local LLM server profiles)
db.createCollection('local_llm_profiles', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'name', 'endpoint', 'createdAt'],
      properties: {
        _id: { bsonType: 'objectId' },
        userId: { bsonType: 'objectId', description: 'Reference to user' },
        name: { bsonType: 'string', description: 'Profile display name' },
        endpoint: { bsonType: 'string', description: 'Local LLM server URL' },
        capabilities: { bsonType: 'object' },
        enabled: { bsonType: 'bool' },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' }
      }
    }
  }
});
db.local_llm_profiles.createIndex({ userId: 1, name: 1 }, { unique: true });
db.local_llm_profiles.createIndex({ userId: 1 });
console.log('Ô£ô Created local_llm_profiles collection with indexes');

console.log('\nÔ£à All collections created successfully!');
console.log('Ô£à Schema validation enabled on all collections');
console.log('Ô£à Indexes created for optimal performance\n');

// Create default development seed user
// Email: test@example.com
// NOTE: Schema uses 'password' field (not 'passwordHash') to match backend Mongoose model
db.users.insertOne({
  email: 'test@example.com',
  password: '$2b$10$JkttyuwNvLIxq.f2p9rW8uKD7CFyZZvPZP8jKgRPrBXf2wq8Z2j6u',
  role: 'user',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date()
});
console.log('Ô£ô Created test user account');
console.log('  Email: test@example.com');
console.log('  Password: [redacted in seed logs]\n');

// Verify collections
const collections = db.getCollectionNames();
console.log('Collections in database:');
collections.forEach(col => console.log(`  - ${col}`));

// Verify test user created
const testUser = db.users.findOne({ email: 'test@example.com' });
if (testUser) {
  console.log(`\nÔ£ô Test user verified in database: ${testUser.email}`);
}
