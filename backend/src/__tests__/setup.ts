// Backend test setup
// Configure global test environment
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { randomUUID } from 'crypto';
import { buildTestMongoUri } from './testMongoUri';

// Extend Jest timeout for async operations
jest.setTimeout(30000); // Augmenter à 30s pour connexion MongoDB

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DEFAULT_TEST_DB_NAME = 'irdd-test';
const TEST_WORKER_ID = process.env.JEST_WORKER_ID || '1';
const TEST_DB_NAME = `${DEFAULT_TEST_DB_NAME}-${TEST_WORKER_ID}-${randomUUID().replace(/-/g, '')}`;
let testClient: ReturnType<typeof mongoose.connection.getClient>;

function assertTestConnection(): void {
    if (mongoose.connection.name !== TEST_DB_NAME || mongoose.connection.getClient() !== testClient) {
        throw new Error('Refusing to clean a MongoDB connection other than the isolated test database');
    }
}

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-unit-tests';
process.env.ENCRYPTION_KEY = 'test-master-encryption-key-32-chars-minimum-length-required';
process.env.MONGODB_URI = buildTestMongoUri(process.env.MONGODB_URI, TEST_DB_NAME);

// Hook global: connexion MongoDB AVANT tous les tests
beforeAll(async () => {
    const MONGODB_URI_TEST = process.env.MONGODB_URI || buildTestMongoUri(undefined, TEST_DB_NAME);
    await mongoose.connect(MONGODB_URI_TEST);
    testClient = mongoose.connection.getClient();
    assertTestConnection();
});

// Hook global: déconnexion MongoDB APRÈS tous les tests
afterAll(async () => {
    // Nettoyer base de données test
    if (mongoose.connection.readyState === 1) {
        assertTestConnection();
        await mongoose.connection.dropDatabase();
        await mongoose.connection.close();
    }
});

// Hook après chaque test: vider collections (isolation tests)
// ATTENTION: Préserve la collection 'users' pour réutiliser testUserId
afterEach(async () => {
    if (mongoose.connection.readyState === 1) {
        assertTestConnection();
        const collections = mongoose.connection.collections;
        for (const key in collections) {
            // Préserver users (gérés par afterAll de chaque suite de tests)
            if (key !== 'users') {
                await collections[key].deleteMany({});
            }
        }
    }
});
