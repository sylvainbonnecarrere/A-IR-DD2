import dotenv from 'dotenv';
import path from 'path';

const isTestEnvironment = process.env.NODE_ENV === 'test';

// Charger .env - chercher à partir du répertoire src et remonter
// src est à src/, donc ../ = backend/, ../../ = racine du projet
const envPath = path.resolve(__dirname, '../../.env');
if (!isTestEnvironment) {
    console.log(`📁 Loading .env from: ${envPath}`);
}

const result = dotenv.config({ 
    path: envPath
});

if (result.error) {
    if (!isTestEnvironment) {
        console.warn('⚠️  .env file not found - using environment variables');
    }
}

/**
 * Configuration centralisée
 * Principe: Single Responsibility - une source de vérité pour la config
 */
export const config = {
    // Application
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3001', 10),
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4000',

    // Database
    mongodbUri: process.env.MONGODB_URI || '',
    mongodbTestUri: process.env.MONGODB_TEST_URI || '',

    // Security - Secrets (Dependency Injection pattern)
    jwt: {
        secret: process.env.JWT_SECRET || '',
        expiration: process.env.JWT_EXPIRATION || '24h',
        refreshSecret: process.env.REFRESH_TOKEN_SECRET || '',
        refreshExpiration: process.env.REFRESH_TOKEN_EXPIRATION || '7d'
    },

    encryption: {
        key: process.env.ENCRYPTION_KEY || ''
    },

    bcrypt: {
        rounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10)
    },

    runtime: {
        nodeExecutable: process.env.RUNTIME_NODE_EXECUTABLE || process.execPath || 'node',
        pythonExecutables: (process.env.RUNTIME_PYTHON_EXECUTABLES || 'python3,python')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean),
        dockerExecutable: process.env.RUNTIME_DOCKER_EXECUTABLE || 'docker',
        nodeRuntimeImage: process.env.RUNTIME_NODE_IMAGE || 'airdd2-runtime-node:22.22.2-ubuntu-noble',
        pythonRuntimeImage: process.env.RUNTIME_PYTHON_IMAGE || 'airdd2-runtime-python:3.12-ubuntu-noble',
        pythonProvisioningImage: process.env.RUNTIME_PYTHON_PROVISIONING_IMAGE || 'airdd2-python-provisioning:3.12-ubuntu-noble',
        probeTimeoutMs: parseInt(process.env.RUNTIME_PROBE_TIMEOUT_MS || '8000', 10),
        provisionTimeoutMs: parseInt(process.env.RUNTIME_PROVISION_TIMEOUT_MS || '120000', 10),
        nativePythonProvisionOnStartup: (process.env.RUNTIME_NATIVE_PYTHON_PROVISION_ON_STARTUP || 'true').toLowerCase() !== 'false'
    }
};

/**
 * Valider les secrets critiques au démarrage
 * Principe: Fail-fast - détecter les erreurs de configuration au démarrage
 */
export function validateConfig(): void {
    const required = [
        { key: 'MONGODB_URI', value: config.mongodbUri },
        { key: 'JWT_SECRET', value: config.jwt.secret },
        { key: 'ENCRYPTION_KEY', value: config.encryption.key }
    ];

    const missing = required.filter(r => !r.value);

    if (missing.length > 0) {
        console.error('❌ CRITICAL: Missing required environment variables:');
        missing.forEach(m => console.error(`   - ${m.key}`));
        console.error('\nPlease check your .env file or environment variables');
        process.exit(1);
    }

    if (!isTestEnvironment) {
        console.log('✅ Configuration validated');
    }
}

export default config;
