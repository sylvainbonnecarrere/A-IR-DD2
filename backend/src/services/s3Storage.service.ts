/**
 * @fileoverview Service de stockage Amazon S3 (Strategy Pattern)
 * 
 * Implémente ICloudStorageStrategy pour AWS S3 et services compatibles (MinIO).
 * 
 * Dépendances requises:
 * - @aws-sdk/client-s3
 * - @aws-sdk/s3-request-presigner
 * 
 * Installation: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 * 
 * @see backend/src/types/cloudStorage.ts
 * @see backend/src/services/mediaStorage.service.ts
 */

import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    HeadBucketCommand,
    ListObjectsV2Command,
    PutObjectCommandInput,
    GetObjectCommandInput,
    S3ClientConfig
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

import {
    ICloudStorageStrategy,
    CloudStorageConfig,
    CloudStorageResult,
    SignedUrlOptions,
    CloudConnectionTestResult,
    CloudStorageError,
    CloudStorageErrorCodes,
    S3StorageConfig
} from '../types/cloudStorage';

// ============================================
// CONSTANTES
// ============================================

const DEBUG = process.env.DEBUG_CLOUD_STORAGE === 'true' || process.env.NODE_ENV === 'development';
const debugLog = (message: string) => {
    if (DEBUG) console.log(`[S3Storage] ${message}`);
};

// Durées par défaut
const DEFAULT_SIGNED_URL_EXPIRY = 3600; // 1 heure
const DEFAULT_UPLOAD_EXPIRY = 300; // 5 minutes pour upload

// ============================================
// SERVICE S3 STORAGE STRATEGY
// ============================================

export class S3StorageStrategy implements ICloudStorageStrategy {
    readonly provider = 's3' as const;
    
    private client: S3Client | null = null;
    private config: S3StorageConfig | null = null;
    private bucketName: string = '';
    private keyPrefix: string = '';
    
    /**
     * Initialiser le client S3 avec la configuration
     */
    async initialize(config: CloudStorageConfig): Promise<void> {
        if (config.provider !== 's3' || !config.s3) {
            throw new CloudStorageError(
                'Configuration S3 invalide',
                CloudStorageErrorCodes.INVALID_CONFIG,
                's3'
            );
        }
        
        this.config = config.s3;
        this.bucketName = config.s3.bucketName;
        this.keyPrefix = config.s3.keyPrefix || '';
        
        const clientConfig: S3ClientConfig = {
            region: config.s3.region,
            credentials: {
                accessKeyId: config.s3.accessKeyId,
                secretAccessKey: config.s3.secretAccessKey
            }
        };
        
        // Configuration pour MinIO/LocalStack
        if (config.s3.endpoint) {
            clientConfig.endpoint = config.s3.endpoint;
            clientConfig.forcePathStyle = config.s3.forcePathStyle ?? true;
        }
        
        this.client = new S3Client(clientConfig);
        
        debugLog(`Initialized with bucket: ${this.bucketName}, region: ${config.s3.region}`);
    }
    
    /**
     * Vérifie si le service est initialisé
     */
    isInitialized(): boolean {
        return this.client !== null && this.config !== null;
    }
    
    /**
     * Vérifie l'initialisation et lance une erreur si non initialisé
     */
    private ensureInitialized(): void {
        if (!this.isInitialized()) {
            throw new CloudStorageError(
                'Client S3 non initialisé. Appelez initialize() d\'abord.',
                CloudStorageErrorCodes.NOT_INITIALIZED,
                's3'
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
     * Upload un fichier vers S3
     */
    async upload(
        key: string,
        data: Buffer,
        contentType: string,
        metadata?: Record<string, string>
    ): Promise<CloudStorageResult> {
        this.ensureInitialized();
        
        const fullKey = this.buildKey(key);
        
        try {
            const params: PutObjectCommandInput = {
                Bucket: this.bucketName,
                Key: fullKey,
                Body: data,
                ContentType: contentType,
                ContentLength: data.length
            };
            
            // Ajouter les métadonnées
            if (metadata) {
                params.Metadata = metadata;
            }
            
            // ACL si configuré
            if (this.config?.defaultAcl) {
                params.ACL = this.config.defaultAcl as any;
            }
            
            const command = new PutObjectCommand(params);
            const response = await this.client!.send(command);
            
            debugLog(`Uploaded: ${fullKey} (${data.length} bytes)`);
            
            return {
                success: true,
                key: fullKey,
                etag: response.ETag?.replace(/"/g, '')
            };
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[S3Storage] Upload failed for ${fullKey}:`, errorMessage);
            
            return {
                success: false,
                error: errorMessage,
                errorCode: CloudStorageErrorCodes.UPLOAD_FAILED
            };
        }
    }
    
    /**
     * Télécharge un fichier depuis S3
     */
    async download(key: string): Promise<Buffer> {
        this.ensureInitialized();
        
        const fullKey = this.buildKey(key);
        
        try {
            const params: GetObjectCommandInput = {
                Bucket: this.bucketName,
                Key: fullKey
            };
            
            const command = new GetObjectCommand(params);
            const response = await this.client!.send(command);
            
            if (!response.Body) {
                throw new Error('Response body is empty');
            }
            
            // Convertir le stream en Buffer
            const stream = response.Body as Readable;
            const chunks: Buffer[] = [];
            
            return new Promise((resolve, reject) => {
                stream.on('data', (chunk) => chunks.push(chunk));
                stream.on('end', () => resolve(Buffer.concat(chunks)));
                stream.on('error', reject);
            });
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            
            // Vérifier si c'est une erreur "Not Found"
            if ((error as any).name === 'NoSuchKey' || (error as any).Code === 'NoSuchKey') {
                throw new CloudStorageError(
                    `Fichier non trouvé: ${fullKey}`,
                    CloudStorageErrorCodes.FILE_NOT_FOUND,
                    's3'
                );
            }
            
            throw new CloudStorageError(
                `Erreur téléchargement: ${errorMessage}`,
                CloudStorageErrorCodes.DOWNLOAD_FAILED,
                's3',
                { key: fullKey }
            );
        }
    }
    
    /**
     * Supprime un fichier de S3
     */
    async delete(key: string): Promise<boolean> {
        this.ensureInitialized();
        
        const fullKey = this.buildKey(key);
        
        try {
            const command = new DeleteObjectCommand({
                Bucket: this.bucketName,
                Key: fullKey
            });
            
            await this.client!.send(command);
            debugLog(`Deleted: ${fullKey}`);
            
            return true;
            
        } catch (error) {
            console.error(`[S3Storage] Delete failed for ${fullKey}:`, error);
            return false;
        }
    }
    
    /**
     * Vérifie si un fichier existe
     */
    async exists(key: string): Promise<boolean> {
        this.ensureInitialized();
        
        const fullKey = this.buildKey(key);
        
        try {
            const command = new HeadObjectCommand({
                Bucket: this.bucketName,
                Key: fullKey
            });
            
            await this.client!.send(command);
            return true;
            
        } catch (error) {
            if ((error as any).name === 'NotFound' || (error as any).$metadata?.httpStatusCode === 404) {
                return false;
            }
            throw error;
        }
    }
    
    /**
     * Génère une URL présignée pour accès temporaire
     */
    async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
        this.ensureInitialized();
        
        const fullKey = this.buildKey(key);
        const expiresIn = options.expiresIn ?? DEFAULT_SIGNED_URL_EXPIRY;
        
        try {
            let command;
            
            switch (options.action) {
                case 'read':
                    command = new GetObjectCommand({
                        Bucket: this.bucketName,
                        Key: fullKey,
                        ResponseContentDisposition: options.responseContentDisposition
                    });
                    break;
                    
                case 'write':
                    command = new PutObjectCommand({
                        Bucket: this.bucketName,
                        Key: fullKey,
                        ContentType: options.contentType
                    });
                    break;
                    
                case 'delete':
                    command = new DeleteObjectCommand({
                        Bucket: this.bucketName,
                        Key: fullKey
                    });
                    break;
                    
                default:
                    throw new Error(`Action non supportée: ${options.action}`);
            }
            
            const url = await getSignedUrl(this.client!, command, { expiresIn });
            
            debugLog(`Generated ${options.action} URL for ${fullKey} (expires in ${expiresIn}s)`);
            
            return url;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            
            throw new CloudStorageError(
                `Erreur génération URL signée: ${errorMessage}`,
                CloudStorageErrorCodes.SIGNED_URL_FAILED,
                's3',
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
            const headBucketCommand = new HeadBucketCommand({
                Bucket: this.bucketName
            });
            
            await this.client!.send(headBucketCommand);
            result.details!.bucketExists = true;
            debugLog(`Bucket ${this.bucketName} exists`);
            
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
                result.message = `Connexion S3 réussie - Bucket: ${this.bucketName}`;
            } else {
                result.message = 'Connexion partielle - Vérifiez les permissions';
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorName = (error as any).name || (error as any).Code || '';
            
            result.message = `Échec connexion S3: ${errorMessage}`;
            result.details!.errorCode = errorName;
            result.details!.errorMessage = errorMessage;
            
            // Messages d'erreur plus explicites
            if (errorName === 'NoSuchBucket') {
                result.message = `Le bucket "${this.bucketName}" n'existe pas`;
            } else if (errorName === 'AccessDenied' || errorName === 'Forbidden') {
                result.message = 'Accès refusé - Vérifiez vos credentials et permissions IAM';
            } else if (errorName === 'InvalidAccessKeyId') {
                result.message = 'Access Key ID invalide';
            } else if (errorName === 'SignatureDoesNotMatch') {
                result.message = 'Secret Access Key invalide';
            }
            
            console.error('[S3Storage] Connection test failed:', errorMessage);
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
            const command = new ListObjectsV2Command({
                Bucket: this.bucketName,
                Prefix: fullPrefix,
                MaxKeys: maxKeys
            });
            
            const response = await this.client!.send(command);
            
            const keys = (response.Contents || [])
                .map((obj: { Key?: string }) => obj.Key!)
                .filter(Boolean);
            
            return {
                keys,
                truncated: response.IsTruncated ?? false
            };
            
        } catch (error) {
            console.error('[S3Storage] List failed:', error);
            return { keys: [], truncated: false };
        }
    }
}

// ============================================
// FACTORY HELPER
// ============================================

let s3Instance: S3StorageStrategy | null = null;

/**
 * Obtenir une instance singleton du service S3
 */
export function getS3StorageService(): S3StorageStrategy {
    if (!s3Instance) {
        s3Instance = new S3StorageStrategy();
    }
    return s3Instance;
}

/**
 * Réinitialiser l'instance (pour tests)
 */
export function resetS3StorageService(): void {
    s3Instance = null;
}
