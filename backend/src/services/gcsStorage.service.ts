/**
 * @fileoverview Service de stockage Google Cloud Storage (Strategy Pattern)
 * 
 * Implémente ICloudStorageStrategy pour Google Cloud Storage.
 * 
 * Dépendances requises:
 * - @google-cloud/storage
 * 
 * Installation: npm install @google-cloud/storage
 * 
 * @see backend/src/types/cloudStorage.ts
 * @see backend/src/services/mediaStorage.service.ts
 */

import { Storage, Bucket, File, GetSignedUrlConfig } from '@google-cloud/storage';
import { Readable } from 'stream';

import {
    ICloudStorageStrategy,
    CloudStorageConfig,
    CloudStorageResult,
    SignedUrlOptions,
    CloudConnectionTestResult,
    CloudStorageError,
    CloudStorageErrorCodes,
    GCSStorageConfig
} from '../types/cloudStorage';

// ============================================
// CONSTANTES
// ============================================

const DEBUG = process.env.DEBUG_CLOUD_STORAGE === 'true' || process.env.NODE_ENV === 'development';
const debugLog = (message: string) => {
    if (DEBUG) console.log(`[GCSStorage] ${message}`);
};

// Durées par défaut
const DEFAULT_SIGNED_URL_EXPIRY = 3600; // 1 heure
const V4_SIGNATURE_VERSION = 'v4';

// ============================================
// SERVICE GCS STORAGE STRATEGY
// ============================================

export class GCSStorageStrategy implements ICloudStorageStrategy {
    readonly provider = 'gcs' as const;
    
    private storage: Storage | null = null;
    private bucket: Bucket | null = null;
    private config: GCSStorageConfig | null = null;
    private keyPrefix: string = '';
    
    /**
     * Initialiser le client GCS avec la configuration
     */
    async initialize(config: CloudStorageConfig): Promise<void> {
        if (config.provider !== 'gcs' || !config.gcs) {
            throw new CloudStorageError(
                'Configuration GCS invalide',
                CloudStorageErrorCodes.INVALID_CONFIG,
                'gcs'
            );
        }
        
        this.config = config.gcs;
        this.keyPrefix = config.gcs.keyPrefix || '';
        
        // Configuration du client
        const storageConfig: {
            projectId: string;
            credentials?: any;
        } = {
            projectId: config.gcs.projectId
        };
        
        // Si une clé de service account est fournie, la parser
        if (config.gcs.serviceAccountKey) {
            try {
                const credentials = JSON.parse(config.gcs.serviceAccountKey);
                storageConfig.credentials = credentials;
            } catch (error) {
                throw new CloudStorageError(
                    'Clé de service account invalide (JSON mal formé)',
                    CloudStorageErrorCodes.INVALID_CREDENTIALS,
                    'gcs'
                );
            }
        }
        
        this.storage = new Storage(storageConfig);
        this.bucket = this.storage.bucket(config.gcs.bucketName);
        
        debugLog(`Initialized with bucket: ${config.gcs.bucketName}, project: ${config.gcs.projectId}`);
    }
    
    /**
     * Vérifie si le service est initialisé
     */
    isInitialized(): boolean {
        return this.storage !== null && this.bucket !== null;
    }
    
    /**
     * Vérifie l'initialisation et lance une erreur si non initialisé
     */
    private ensureInitialized(): void {
        if (!this.isInitialized()) {
            throw new CloudStorageError(
                'Client GCS non initialisé. Appelez initialize() d\'abord.',
                CloudStorageErrorCodes.NOT_INITIALIZED,
                'gcs'
            );
        }
    }
    
    /**
     * Construit la clé complète avec préfixe
     */
    private buildKey(key: string): string {
        return this.keyPrefix ? `${this.keyPrefix}${key}` : key;
    }
    
    /**
     * Upload un fichier vers GCS
     */
    async upload(
        key: string,
        data: Buffer,
        contentType: string,
        metadata?: Record<string, string>
    ): Promise<CloudStorageResult> {
        this.ensureInitialized();
        
        const fullKey = this.buildKey(key);
        const file = this.bucket!.file(fullKey);
        
        try {
            // Créer un stream à partir du buffer
            const stream = Readable.from(data);
            
            // Options d'upload
            const options = {
                contentType,
                metadata: metadata ? { metadata } : undefined
            };
            
            await new Promise((resolve, reject) => {
                stream
                    .pipe(file.createWriteStream(options))
                    .on('error', reject)
                    .on('finish', resolve);
            });
            
            // Obtenir les métadonnées pour l'ETag
            const [fileMetadata] = await file.getMetadata();
            
            debugLog(`Uploaded: ${fullKey} (${data.length} bytes)`);
            
            return {
                success: true,
                key: fullKey,
                etag: fileMetadata.etag
            };
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[GCSStorage] Upload failed for ${fullKey}:`, errorMessage);
            
            return {
                success: false,
                error: errorMessage,
                errorCode: CloudStorageErrorCodes.UPLOAD_FAILED
            };
        }
    }
    
    /**
     * Télécharge un fichier depuis GCS
     */
    async download(key: string): Promise<Buffer> {
        this.ensureInitialized();
        
        const fullKey = this.buildKey(key);
        const file = this.bucket!.file(fullKey);
        
        try {
            const [contents] = await file.download();
            return contents;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorCode = (error as any).code;
            
            // Vérifier si c'est une erreur "Not Found"
            if (errorCode === 404) {
                throw new CloudStorageError(
                    `Fichier non trouvé: ${fullKey}`,
                    CloudStorageErrorCodes.FILE_NOT_FOUND,
                    'gcs'
                );
            }
            
            throw new CloudStorageError(
                `Erreur téléchargement: ${errorMessage}`,
                CloudStorageErrorCodes.DOWNLOAD_FAILED,
                'gcs',
                { key: fullKey }
            );
        }
    }
    
    /**
     * Supprime un fichier de GCS
     */
    async delete(key: string): Promise<boolean> {
        this.ensureInitialized();
        
        const fullKey = this.buildKey(key);
        const file = this.bucket!.file(fullKey);
        
        try {
            await file.delete();
            debugLog(`Deleted: ${fullKey}`);
            return true;
            
        } catch (error) {
            const errorCode = (error as any).code;
            
            // Si le fichier n'existe pas, on considère que c'est OK
            if (errorCode === 404) {
                return true;
            }
            
            console.error(`[GCSStorage] Delete failed for ${fullKey}:`, error);
            return false;
        }
    }
    
    /**
     * Vérifie si un fichier existe
     */
    async exists(key: string): Promise<boolean> {
        this.ensureInitialized();
        
        const fullKey = this.buildKey(key);
        const file = this.bucket!.file(fullKey);
        
        try {
            const [exists] = await file.exists();
            return exists;
            
        } catch (error) {
            console.error(`[GCSStorage] Exists check failed for ${fullKey}:`, error);
            return false;
        }
    }
    
    /**
     * Génère une URL présignée pour accès temporaire
     */
    async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
        this.ensureInitialized();
        
        const fullKey = this.buildKey(key);
        const file = this.bucket!.file(fullKey);
        const expiresIn = options.expiresIn ?? DEFAULT_SIGNED_URL_EXPIRY;
        
        try {
            // Mapper l'action vers le format GCS
            let action: 'read' | 'write' | 'delete' | 'resumable';
            switch (options.action) {
                case 'read':
                    action = 'read';
                    break;
                case 'write':
                    action = 'write';
                    break;
                case 'delete':
                    action = 'delete';
                    break;
                default:
                    throw new Error(`Action non supportée: ${options.action}`);
            }
            
            const signedUrlConfig: GetSignedUrlConfig = {
                version: V4_SIGNATURE_VERSION,
                action,
                expires: Date.now() + expiresIn * 1000
            };
            
            // Ajouter Content-Type pour upload
            if (options.contentType && action === 'write') {
                signedUrlConfig.contentType = options.contentType;
            }
            
            // Ajouter Content-Disposition pour download
            if (options.responseContentDisposition && action === 'read') {
                signedUrlConfig.responseDisposition = options.responseContentDisposition;
            }
            
            const [url] = await file.getSignedUrl(signedUrlConfig);
            
            debugLog(`Generated ${options.action} URL for ${fullKey} (expires in ${expiresIn}s)`);
            
            return url;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            
            throw new CloudStorageError(
                `Erreur génération URL signée: ${errorMessage}`,
                CloudStorageErrorCodes.SIGNED_URL_FAILED,
                'gcs',
                { key: fullKey, action: options.action }
            );
        }
    }
    
    /**
     * Teste la connexion et les permissions
     */
    async testConnection(): Promise<CloudConnectionTestResult> {
        this.ensureInitialized();
        
        const result: CloudConnectionTestResult = {
            success: false,
            message: '',
            details: {
                bucketExists: false,
                hasWriteAccess: false,
                hasReadAccess: false
            }
        };
        
        try {
            // Test 1: Vérifier que le bucket existe
            const [exists] = await this.bucket!.exists();
            result.details!.bucketExists = exists;
            
            if (!exists) {
                result.message = `Le bucket "${this.config!.bucketName}" n'existe pas`;
                return result;
            }
            
            debugLog(`Bucket ${this.config!.bucketName} exists`);
            
            // Test 2: Tester l'écriture
            const testKey = `${this.keyPrefix}_connection_test_${Date.now()}.txt`;
            const testData = Buffer.from('Connection test');
            
            const uploadResult = await this.upload(testKey, testData, 'text/plain');
            if (uploadResult.success) {
                result.details!.hasWriteAccess = true;
                debugLog('Write access confirmed');
                
                // Test 3: Tester la lecture
                const downloadedData = await this.download(testKey);
                if (downloadedData.toString() === 'Connection test') {
                    result.details!.hasReadAccess = true;
                    debugLog('Read access confirmed');
                }
                
                // Nettoyage
                await this.delete(testKey);
            }
            
            // Succès global
            if (result.details!.bucketExists && result.details!.hasWriteAccess && result.details!.hasReadAccess) {
                result.success = true;
                result.message = `Connexion GCS réussie - Bucket: ${this.config!.bucketName}`;
            } else {
                result.message = 'Connexion partielle - Vérifiez les permissions';
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorCode = (error as any).code;
            
            result.message = `Échec connexion GCS: ${errorMessage}`;
            result.details!.errorCode = errorCode;
            result.details!.errorMessage = errorMessage;
            
            // Messages d'erreur plus explicites
            if (errorCode === 403) {
                result.message = 'Accès refusé - Vérifiez vos credentials et permissions IAM';
            } else if (errorCode === 404) {
                result.message = `Le bucket "${this.config!.bucketName}" n'existe pas`;
            } else if (errorMessage.includes('invalid_grant')) {
                result.message = 'Clé de service account invalide ou expirée';
            }
            
            console.error('[GCSStorage] Connection test failed:', errorMessage);
        }
        
        return result;
    }
    
    /**
     * Liste les fichiers avec un préfixe donné
     */
    async listFiles(prefix: string, maxKeys: number = 1000): Promise<{
        keys: string[];
        truncated: boolean;
    }> {
        this.ensureInitialized();
        
        const fullPrefix = this.buildKey(prefix);
        
        try {
            const [files] = await this.bucket!.getFiles({
                prefix: fullPrefix,
                maxResults: maxKeys
            });
            
            const keys = files.map((file: { name: string }) => file.name);
            
            return {
                keys,
                truncated: files.length >= maxKeys
            };
            
        } catch (error) {
            console.error('[GCSStorage] List failed:', error);
            return { keys: [], truncated: false };
        }
    }
}

// ============================================
// FACTORY HELPER
// ============================================

let gcsInstance: GCSStorageStrategy | null = null;

/**
 * Obtenir une instance singleton du service GCS
 */
export function getGCSStorageService(): GCSStorageStrategy {
    if (!gcsInstance) {
        gcsInstance = new GCSStorageStrategy();
    }
    return gcsInstance;
}

/**
 * Réinitialiser l'instance (pour tests)
 */
export function resetGCSStorageService(): void {
    gcsInstance = null;
}
