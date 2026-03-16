// Backend test setup
// Configure global test environment
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Extend Jest timeout for async operations
jest.setTimeout(30000); // Augmenter à 30s pour connexion MongoDB

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DEFAULT_TEST_DB_NAME = 'irdd-test';
const TEST_WORKER_ID = process.env.JEST_WORKER_ID || '1';

function buildTestMongoUri(baseUri?: string, dbName = DEFAULT_TEST_DB_NAME): string {
    if (!baseUri) {
        return `mongodb://localhost:27017/${dbName}`;
    }

    const withDbName = baseUri.match(/\/[^/?]+(\?.*)?$/)
        ? baseUri.replace(/\/([^/?]+)(\?.*)?$/, `/${dbName}$2`)
        : `${baseUri.replace(/\/?$/, '')}/${dbName}`;

    return withDbName;
}

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-unit-tests';
process.env.ENCRYPTION_KEY = 'test-master-encryption-key-32-chars-minimum-length-required';
process.env.MONGODB_URI = buildTestMongoUri(process.env.MONGODB_URI, `${DEFAULT_TEST_DB_NAME}-worker-${TEST_WORKER_ID}`);

// Hook global: connexion MongoDB AVANT tous les tests
beforeAll(async () => {
    const MONGODB_URI_TEST = process.env.MONGODB_URI || buildTestMongoUri(undefined, `${DEFAULT_TEST_DB_NAME}-worker-${TEST_WORKER_ID}`);
    await mongoose.connect(MONGODB_URI_TEST);
});

// Hook global: déconnexion MongoDB APRÈS tous les tests
afterAll(async () => {
    // Nettoyer base de données test
    if (mongoose.connection.readyState === 1) {
        await mongoose.connection.dropDatabase();
        await mongoose.connection.close();
    }
});

// Hook après chaque test: vider collections (isolation tests)
// ATTENTION: Préserve la collection 'users' pour réutiliser testUserId
afterEach(async () => {
    if (mongoose.connection.readyState === 1) {
        const collections = mongoose.connection.collections;
        for (const key in collections) {
            // Préserver users (gérés par afterAll de chaque suite de tests)
            if (key !== 'users') {
                await collections[key].deleteMany({});
            }
        }
    }
});
