/**
 * @fileoverview Types pour le stockage cloud (S3/GCS)
 * 
 * Architecture:
 * - Strategy Pattern pour les providers cloud
 * - Factory Pattern pour instanciation
 * - Interface segregation pour flexibilité
 * 
 * Sécurité:
 * - Les credentials sont chiffrés avant stockage (AES-256-GCM)
 * - Les URLs signées ont une durée de vie limitée
 * - Validation des buckets et clés
 * 
 * @see backend/src/services/s3Storage.service.ts
 * @see backend/src/services/gcsStorage.service.ts
 */

// ============================================
// TYPES PROVIDER
// ============================================

/**
 * Providers cloud supportés
 */
export type CloudProvider = 's3' | 'gcs';

// ============================================
// CONFIGURATION S3 (AWS / MinIO)
// ============================================

/**
 * Configuration pour Amazon S3 ou compatible (MinIO)
 */
export interface S3StorageConfig {
    /** AWS Access Key ID */
    accessKeyId: string;
    
    /** AWS Secret Access Key (chiffré en BDD) */
    secretAccessKey: string;
    
    /** Région AWS (ex: us-east-1, eu-west-1) */
    region: string;
    
    /** Nom du bucket S3 */
    bucketName: string;
    
    /** Endpoint custom pour MinIO/LocalStack (optionnel) */
    endpoint?: string;
    
    /** Force path-style pour MinIO (bucket dans le path au lieu du subdomain) */
    forcePathStyle?: boolean;
    
    /** Préfixe pour les clés (optionnel, ex: "media/") */
    keyPrefix?: string;
    
    /** ACL par défaut pour les uploads (ex: "private", "public-read") */
    defaultAcl?: string;
}

/**
 * Régions AWS S3 disponibles
 */
export const S3_REGIONS = [
    { value: 'us-east-1', label: 'US East (N. Virginia)' },
    { value: 'us-east-2', label: 'US East (Ohio)' },
    { value: 'us-west-1', label: 'US West (N. California)' },
    { value: 'us-west-2', label: 'US West (Oregon)' },
    { value: 'eu-west-1', label: 'EU (Ireland)' },
    { value: 'eu-west-2', label: 'EU (London)' },
    { value: 'eu-west-3', label: 'EU (Paris)' },
    { value: 'eu-central-1', label: 'EU (Frankfurt)' },
    { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
    { value: 'ap-northeast-2', label: 'Asia Pacific (Seoul)' },
    { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
    { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney)' },
    { value: 'ap-south-1', label: 'Asia Pacific (Mumbai)' },
    { value: 'sa-east-1', label: 'South America (São Paulo)' },
    { value: 'ca-central-1', label: 'Canada (Central)' }
] as const;

export type S3Region = typeof S3_REGIONS[number]['value'];

// ============================================
// CONFIGURATION GCS (Google Cloud Storage)
// ============================================

/**
 * Configuration pour Google Cloud Storage
 */
export interface GCSStorageConfig {
    /** ID du projet Google Cloud */
    projectId: string;
    
    /** Nom du bucket GCS */
    bucketName: string;
    
    /** Clé de compte de service (JSON stringifié, chiffré en BDD) */
    serviceAccountKey?: string;
    
    /** Région/location du bucket (optionnel) */
    location?: string;
    
    /** Préfixe pour les clés (optionnel) */
    keyPrefix?: string;
}

/**
 * Locations GCS disponibles
 */
export const GCS_LOCATIONS = [
    { value: 'US', label: 'United States (multi-region)' },
    { value: 'EU', label: 'European Union (multi-region)' },
    { value: 'ASIA', label: 'Asia (multi-region)' },
    { value: 'us-east1', label: 'South Carolina' },
    { value: 'us-west1', label: 'Oregon' },
    { value: 'europe-west1', label: 'Belgium' },
    { value: 'europe-west2', label: 'London' },
    { value: 'europe-west3', label: 'Frankfurt' },
    { value: 'asia-east1', label: 'Taiwan' },
    { value: 'asia-northeast1', label: 'Tokyo' }
] as const;

// ============================================
// CONFIGURATION UNIFIÉE
// ============================================

/**
 * Configuration cloud complète (discriminated union)
 */
export interface CloudStorageConfig {
    /** Provider sélectionné */
    provider: CloudProvider;
    
    /** Configuration S3 (si provider === 's3') */
    s3?: S3StorageConfig;
    
    /** Configuration GCS (si provider === 'gcs') */
    gcs?: GCSStorageConfig;
}

/**
 * Version sérialisable pour stockage en BDD
 * (credentials chiffrés)
 */
export interface CloudStorageConfigEncrypted {
    provider: CloudProvider;
    s3?: Omit<S3StorageConfig, 'secretAccessKey'> & {
        secretAccessKeyEncrypted?: string;
    };
    gcs?: Omit<GCSStorageConfig, 'serviceAccountKey'> & {
        serviceAccountKeyEncrypted?: string;
    };
}

// ============================================
// RÉSULTATS OPÉRATIONS
// ============================================

/**
 * Résultat d'une opération de stockage cloud
 */
export interface CloudStorageResult {
    /** Succès de l'opération */
    success: boolean;
    
    /** Clé du fichier dans le bucket */
    key?: string;
    
    /** URL publique ou présignée */
    url?: string;
    
    /** ETag/Version du fichier (si disponible) */
    etag?: string;
    
    /** Message d'erreur si échec */
    error?: string;
    
    /** Code d'erreur technique */
    errorCode?: string;
}

/**
 * Options pour génération d'URL signée
 */
export interface SignedUrlOptions {
    /** Durée de validité en secondes (défaut: 3600 = 1h) */
    expiresIn?: number;
    
    /** Content-Type pour upload */
    contentType?: string;
    
    /** Action autorisée */
    action: 'read' | 'write' | 'delete';
    
    /** Content-Disposition pour download */
    responseContentDisposition?: string;
}

/**
 * Résultat de test de connexion
 */
export interface CloudConnectionTestResult {
    /** Connexion réussie */
    success: boolean;
    
    /** Message descriptif */
    message: string;
    
    /** Détails techniques (si erreur) */
    details?: {
        bucketExists?: boolean;
        hasWriteAccess?: boolean;
        hasReadAccess?: boolean;
        errorCode?: string;
        errorMessage?: string;
    };
}

// ============================================
// INTERFACE STRATEGY (PATTERN)
// ============================================

/**
 * Interface Strategy pour les providers Cloud
 * 
 * Implémenté par:
 * - S3StorageStrategy
 * - GCSStorageStrategy
 * 
 * Permet d'ajouter de nouveaux providers sans modifier le code existant (OCP)
 */
export interface ICloudStorageStrategy {
    /** Identifiant du provider */
    readonly provider: CloudProvider;
    
    /**
     * Initialiser le client avec la configuration
     * @param config Configuration du provider
     */
    initialize(config: CloudStorageConfig): Promise<void>;
    
    /**
     * Vérifier si le service est initialisé
     */
    isInitialized(): boolean;
    
    /**
     * Upload un fichier vers le cloud
     * @param key Clé (chemin) du fichier dans le bucket
     * @param data Contenu du fichier
     * @param contentType Type MIME
     * @param metadata Métadonnées additionnelles
     */
    upload(
        key: string, 
        data: Buffer, 
        contentType: string, 
        metadata?: Record<string, string>
    ): Promise<CloudStorageResult>;
    
    /**
     * Télécharger un fichier depuis le cloud
     * @param key Clé du fichier
     */
    download(key: string): Promise<Buffer>;
    
    /**
     * Supprimer un fichier du cloud
     * @param key Clé du fichier
     */
    delete(key: string): Promise<boolean>;
    
    /**
     * Vérifier si un fichier existe
     * @param key Clé du fichier
     */
    exists(key: string): Promise<boolean>;
    
    /**
     * Générer une URL signée pour accès temporaire
     * @param key Clé du fichier
     * @param options Options de signature
     */
    getSignedUrl(key: string, options: SignedUrlOptions): Promise<string>;
    
    /**
     * Tester la connexion et les permissions
     */
    testConnection(): Promise<CloudConnectionTestResult>;
    
    /**
     * Lister les fichiers avec un préfixe donné
     * @param prefix Préfixe pour filtrer
     * @param maxKeys Nombre maximum de résultats
     */
    listFiles(prefix: string, maxKeys?: number): Promise<{
        keys: string[];
        truncated: boolean;
    }>;
}

// ============================================
// FACTORY TYPES
// ============================================

/**
 * Options pour la factory de stockage cloud
 */
export interface CloudStorageFactoryOptions {
    /** Configuration cloud à utiliser */
    config: CloudStorageConfig;
    
    /** UserId pour chiffrement des credentials */
    userId: string;
}

// ============================================
// ERREURS SPÉCIALISÉES
// ============================================

/**
 * Codes d'erreur pour le stockage cloud
 */
export const CloudStorageErrorCodes = {
    NOT_INITIALIZED: 'CLOUD_NOT_INITIALIZED',
    INVALID_CONFIG: 'CLOUD_INVALID_CONFIG',
    CONNECTION_FAILED: 'CLOUD_CONNECTION_FAILED',
    BUCKET_NOT_FOUND: 'CLOUD_BUCKET_NOT_FOUND',
    ACCESS_DENIED: 'CLOUD_ACCESS_DENIED',
    FILE_NOT_FOUND: 'CLOUD_FILE_NOT_FOUND',
    UPLOAD_FAILED: 'CLOUD_UPLOAD_FAILED',
    DOWNLOAD_FAILED: 'CLOUD_DOWNLOAD_FAILED',
    DELETE_FAILED: 'CLOUD_DELETE_FAILED',
    SIGNED_URL_FAILED: 'CLOUD_SIGNED_URL_FAILED',
    INVALID_CREDENTIALS: 'CLOUD_INVALID_CREDENTIALS',
    PROVIDER_NOT_SUPPORTED: 'CLOUD_PROVIDER_NOT_SUPPORTED'
} as const;

export type CloudStorageErrorCode = typeof CloudStorageErrorCodes[keyof typeof CloudStorageErrorCodes];

/**
 * Exception spécialisée pour erreurs cloud
 */
export class CloudStorageError extends Error {
    constructor(
        message: string,
        public readonly code: CloudStorageErrorCode,
        public readonly provider?: CloudProvider,
        public readonly details?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'CloudStorageError';
    }
}

// ============================================
// UTILITAIRES
// ============================================

/**
 * Valider une configuration cloud
 */
export function validateCloudConfig(config: CloudStorageConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!config.provider) {
        errors.push('Provider requis');
    }
    
    if (config.provider === 's3') {
        if (!config.s3) {
            errors.push('Configuration S3 requise');
        } else {
            if (!config.s3.accessKeyId) errors.push('S3: accessKeyId requis');
            if (!config.s3.secretAccessKey) errors.push('S3: secretAccessKey requis');
            if (!config.s3.bucketName) errors.push('S3: bucketName requis');
            if (!config.s3.region) errors.push('S3: region requise');
        }
    }
    
    if (config.provider === 'gcs') {
        if (!config.gcs) {
            errors.push('Configuration GCS requise');
        } else {
            if (!config.gcs.projectId) errors.push('GCS: projectId requis');
            if (!config.gcs.bucketName) errors.push('GCS: bucketName requis');
        }
    }
    
    return { valid: errors.length === 0, errors };
}

/**
 * Générer une clé cloud à partir du contexte
 */
export function generateCloudKey(context: {
    userId: string;
    workflowId: string;
    agentInstanceId: string;
    fileName: string;
}): string {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    return `users/${context.userId}/workflows/${context.workflowId}/agents/${context.agentInstanceId}/${yearMonth}/${context.fileName}`;
}
