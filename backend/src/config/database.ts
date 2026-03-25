import mongoose from 'mongoose';
import config from './environment';

const isTestEnvironment = process.env.NODE_ENV === 'test';
const logInfo = (...args: unknown[]) => {
    if (!isTestEnvironment) {
        console.log(...args);
    }
};
const logWarn = (...args: unknown[]) => {
    if (!isTestEnvironment) {
        console.warn(...args);
    }
};
const logError = (...args: unknown[]) => {
    if (!isTestEnvironment) {
        console.error(...args);
    }
};

/**
 * Configuration et connexion à MongoDB avec retry logic
 * SOLID Pattern: Dependency Injection - config injectée depuis environment.ts
 */

const MONGODB_URI = config.mongodbUri;
const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 secondes

let isConnected = false;

/**
 * Options de connexion Mongoose
 */
const connectionOptions: mongoose.ConnectOptions = {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4 // Force IPv4
};

/**
 * Connecte à MongoDB avec retry automatique
 */
export async function connectDatabase(retryCount = 0): Promise<void> {
    if (isConnected) {
        logInfo('📦 MongoDB déjà connecté');
        return;
    }

    try {
        logInfo(`🔄 Tentative de connexion à MongoDB (${retryCount + 1}/${MAX_RETRIES})...`);

        await mongoose.connect(MONGODB_URI, connectionOptions);

        isConnected = true;
        logInfo('✅ MongoDB connecté avec succès');
        logInfo(`📍 URI: ${MONGODB_URI.replace(/\/\/.*@/, '//<credentials>@')}`);

    } catch (error) {
        logError('❌ Erreur de connexion MongoDB:', error instanceof Error ? error.message : error);

        if (retryCount < MAX_RETRIES - 1) {
            logInfo(`⏳ Nouvelle tentative dans ${RETRY_DELAY / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return connectDatabase(retryCount + 1);
        } else {
            logError('💀 Échec de connexion MongoDB après toutes les tentatives');
            logError('   Le backend fonctionnera en mode Guest uniquement (localStorage)');
            throw new Error('MongoDB non disponible');
        }
    }
}/**
 * Déconnecte proprement de MongoDB
 */
export async function disconnectDatabase(): Promise<void> {
    if (!isConnected) {
        return;
    }

    try {
        await mongoose.disconnect();
        isConnected = false;
        logInfo('👋 MongoDB déconnecté');
    } catch (error) {
        logError('❌ Erreur lors de la déconnexion MongoDB:', error);
        throw error;
    }
}

/**
 * Gère les événements de connexion Mongoose
 */
mongoose.connection.on('connected', () => {
    logInfo('📡 Mongoose connecté au serveur MongoDB');
});

mongoose.connection.on('error', (err) => {
    logError('❌ Erreur Mongoose:', err);
    isConnected = false;
});

mongoose.connection.on('disconnected', () => {
    logInfo('🔌 Mongoose déconnecté de MongoDB');
    isConnected = false;
});

/**
 * Gestion graceful shutdown
 */
process.on('SIGINT', async () => {
    await disconnectDatabase();
    process.exit(0);
});

export { isConnected };
