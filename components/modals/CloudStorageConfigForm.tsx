/**
 * @file CloudStorageConfigForm.tsx
 * @description Formulaire de configuration des providers cloud (S3/GCS)
 * @domain Design Domain - Persistence Cloud UI
 * 
 * Fonctionnalités:
 * - Sélection provider (S3 / GCS) avec boutons radio visuels
 * - Formulaire S3: accessKeyId, secretAccessKey, region, bucketName, endpoint
 * - Formulaire GCS: projectId, bucketName, serviceAccountKey
 * - Validation JSON pour service account
 * - Indicateur "🔒 Sera chiffré" sous les champs sensibles
 * - Test de connexion avant sauvegarde
 * 
 * @see types.ts (CloudStorageConfig, S3StorageConfig, GCSStorageConfig)
 * @see components/modals/AgentPersistenceForm.tsx
 */

import React, { useState, useCallback } from 'react';
import { 
    CloudStorageConfig, 
    CloudProvider, 
    S3StorageConfig, 
    GCSStorageConfig,
    S3_REGIONS 
} from '../../types';
import { useLocalization } from '../../contexts/LocalizationContext';

// ============================================
// TYPES
// ============================================

interface CloudStorageConfigFormProps {
    config?: CloudStorageConfig;
    onChange: (config: CloudStorageConfig) => void;
    onTestConnection?: (config: CloudStorageConfig) => Promise<{ success: boolean; message: string }>;
    disabled?: boolean;
}

// ============================================
// SOUS-COMPOSANTS
// ============================================

/**
 * Indicateur de champ sensible (sera chiffré)
 */
const SecureFieldIndicator: React.FC = () => (
    <div className="flex items-center gap-1 text-xs text-emerald-400 mt-1">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        <span>Sera chiffré (AES-256)</span>
    </div>
);

/**
 * Champ de formulaire avec label
 */
const FormField: React.FC<{
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: 'text' | 'password' | 'textarea';
    placeholder?: string;
    required?: boolean;
    disabled?: boolean;
    showSecureIndicator?: boolean;
    helperText?: string;
}> = ({ 
    id, 
    label, 
    value, 
    onChange, 
    type = 'text', 
    placeholder, 
    required = false,
    disabled = false,
    showSecureIndicator = false,
    helperText
}) => {
    const baseInputClass = `
        w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg
        text-gray-100 placeholder-gray-400
        focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
        disabled:opacity-50 disabled:cursor-not-allowed
        transition-colors duration-200
    `;

    return (
        <div className="space-y-1">
            <label htmlFor={id} className="block text-sm font-medium text-gray-300">
                {label}
                {required && <span className="text-red-400 ml-1">*</span>}
            </label>
            
            {type === 'textarea' ? (
                <textarea
                    id={id}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    disabled={disabled}
                    rows={4}
                    className={`${baseInputClass} resize-none font-mono text-xs`}
                />
            ) : (
                <input
                    id={id}
                    type={type}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    disabled={disabled}
                    className={baseInputClass}
                />
            )}
            
            {showSecureIndicator && <SecureFieldIndicator />}
            {helperText && (
                <p className="text-xs text-gray-400">{helperText}</p>
            )}
        </div>
    );
};

/**
 * Sélecteur de région S3
 */
const S3RegionSelect: React.FC<{
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}> = ({ value, onChange, disabled }) => (
    <div className="space-y-1">
        <label htmlFor="s3-region" className="block text-sm font-medium text-gray-300">
            Région <span className="text-red-400">*</span>
        </label>
        <select
            id="s3-region"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="
                w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg
                text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500
                disabled:opacity-50 disabled:cursor-not-allowed
            "
        >
            <option value="">Sélectionner une région...</option>
            {S3_REGIONS.map((region) => (
                <option key={region.value} value={region.value}>
                    {region.label}
                </option>
            ))}
        </select>
    </div>
);

// ============================================
// FORMULAIRE S3
// ============================================

const S3ConfigForm: React.FC<{
    config: Partial<S3StorageConfig>;
    onChange: (config: Partial<S3StorageConfig>) => void;
    disabled?: boolean;
}> = ({ config, onChange, disabled }) => {
    const updateField = <K extends keyof S3StorageConfig>(
        field: K, 
        value: S3StorageConfig[K]
    ) => {
        onChange({ ...config, [field]: value });
    };

    return (
        <div className="space-y-4 mt-4 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
            <div className="flex items-center gap-2 mb-3">
                <img 
                    src="https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Amazon_Web_Services_Logo.svg/1200px-Amazon_Web_Services_Logo.svg.png" 
                    alt="AWS" 
                    className="w-8 h-5 object-contain"
                />
                <h4 className="text-sm font-semibold text-gray-200">Configuration Amazon S3</h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                    id="s3-accessKeyId"
                    label="Access Key ID"
                    value={config.accessKeyId || ''}
                    onChange={(v) => updateField('accessKeyId', v)}
                    placeholder="AKIAIOSFODNN7EXAMPLE"
                    required
                    disabled={disabled}
                />
                
                <FormField
                    id="s3-secretAccessKey"
                    label="Secret Access Key"
                    value={config.secretAccessKey || ''}
                    onChange={(v) => updateField('secretAccessKey', v)}
                    type="password"
                    placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                    required
                    disabled={disabled}
                    showSecureIndicator
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <S3RegionSelect
                    value={config.region || ''}
                    onChange={(v) => updateField('region', v)}
                    disabled={disabled}
                />
                
                <FormField
                    id="s3-bucketName"
                    label="Nom du bucket"
                    value={config.bucketName || ''}
                    onChange={(v) => updateField('bucketName', v)}
                    placeholder="my-media-bucket"
                    required
                    disabled={disabled}
                />
            </div>

            <FormField
                id="s3-endpoint"
                label="Endpoint personnalisé"
                value={config.endpoint || ''}
                onChange={(v) => updateField('endpoint', v)}
                placeholder="https://s3.custom-endpoint.com (optionnel, pour MinIO)"
                disabled={disabled}
                helperText="Laisser vide pour AWS S3 standard. Utiliser pour MinIO, LocalStack, etc."
            />
        </div>
    );
};

// ============================================
// FORMULAIRE GCS
// ============================================

const GCSConfigForm: React.FC<{
    config: Partial<GCSStorageConfig>;
    onChange: (config: Partial<GCSStorageConfig>) => void;
    disabled?: boolean;
}> = ({ config, onChange, disabled }) => {
    const [jsonError, setJsonError] = useState<string | null>(null);

    const updateField = <K extends keyof GCSStorageConfig>(
        field: K, 
        value: GCSStorageConfig[K]
    ) => {
        onChange({ ...config, [field]: value });
    };

    const handleServiceAccountChange = (value: string) => {
        // Valider le JSON
        if (value.trim()) {
            try {
                JSON.parse(value);
                setJsonError(null);
            } catch (e) {
                setJsonError('JSON invalide');
            }
        } else {
            setJsonError(null);
        }
        updateField('serviceAccountKey', value);
    };

    return (
        <div className="space-y-4 mt-4 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
            <div className="flex items-center gap-2 mb-3">
                <svg className="w-6 h-6 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12.01 2.25L4.11 6.5v11l7.9 4.25 7.9-4.25v-11l-7.9-4.25zm0 1.65l6.4 3.44-6.4 3.44-6.4-3.44 6.4-3.44zM5.11 7.5l6.4 3.45v6.89l-6.4-3.45V7.5zm12.8 0v6.89l-6.4 3.45v-6.89l6.4-3.45z"/>
                </svg>
                <h4 className="text-sm font-semibold text-gray-200">Configuration Google Cloud Storage</h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                    id="gcs-projectId"
                    label="Project ID"
                    value={config.projectId || ''}
                    onChange={(v) => updateField('projectId', v)}
                    placeholder="my-gcp-project-123"
                    required
                    disabled={disabled}
                />
                
                <FormField
                    id="gcs-bucketName"
                    label="Nom du bucket"
                    value={config.bucketName || ''}
                    onChange={(v) => updateField('bucketName', v)}
                    placeholder="my-media-bucket"
                    required
                    disabled={disabled}
                />
            </div>

            <div className="space-y-1">
                <FormField
                    id="gcs-serviceAccountKey"
                    label="Clé de Service Account (JSON)"
                    value={config.serviceAccountKey || ''}
                    onChange={handleServiceAccountChange}
                    type="textarea"
                    placeholder='{"type": "service_account", "project_id": "...", ...}'
                    disabled={disabled}
                    showSecureIndicator
                    helperText="Collez le contenu JSON du fichier de clé téléchargé depuis Google Cloud Console"
                />
                {jsonError && (
                    <p className="text-xs text-red-400 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        {jsonError}
                    </p>
                )}
            </div>
        </div>
    );
};

// ============================================
// COMPOSANT PRINCIPAL
// ============================================

export const CloudStorageConfigForm: React.FC<CloudStorageConfigFormProps> = ({
    config,
    onChange,
    onTestConnection,
    disabled = false
}) => {
    const { t } = useLocalization();
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    
    // Provider sélectionné
    const provider = config?.provider || 's3';
    
    // Handler changement de provider
    const handleProviderChange = (newProvider: CloudProvider) => {
        setTestResult(null);
        onChange({
            provider: newProvider,
            s3: newProvider === 's3' ? (config?.s3 || {}) as S3StorageConfig : undefined,
            gcs: newProvider === 'gcs' ? (config?.gcs || {}) as GCSStorageConfig : undefined
        });
    };
    
    // Handler changement config S3
    const handleS3Change = (s3Config: Partial<S3StorageConfig>) => {
        setTestResult(null);
        onChange({
            provider: 's3',
            s3: s3Config as S3StorageConfig
        });
    };
    
    // Handler changement config GCS
    const handleGCSChange = (gcsConfig: Partial<GCSStorageConfig>) => {
        setTestResult(null);
        onChange({
            provider: 'gcs',
            gcs: gcsConfig as GCSStorageConfig
        });
    };
    
    // Test de connexion
    const handleTestConnection = useCallback(async () => {
        if (!onTestConnection || !config) return;
        
        setTesting(true);
        setTestResult(null);
        
        try {
            const result = await onTestConnection(config);
            setTestResult(result);
        } catch (error) {
            setTestResult({
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue'
            });
        } finally {
            setTesting(false);
        }
    }, [config, onTestConnection]);

    return (
        <div className="space-y-4">
            {/* Sélection du provider */}
            <div>
                <label className="block text-sm font-medium text-gray-200 mb-3">
                    Provider cloud
                </label>
                <div className="grid grid-cols-2 gap-3">
                    {/* Option S3 */}
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handleProviderChange('s3')}
                        className={`
                            flex items-center gap-3 p-4 rounded-lg border-2 transition-all duration-200
                            ${provider === 's3' 
                                ? 'border-orange-500 bg-orange-500/10' 
                                : 'border-gray-600 bg-gray-700/50 hover:border-gray-500'
                            }
                            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                        `}
                    >
                        <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                            <span className="text-2xl">📦</span>
                        </div>
                        <div className="flex-1 text-left">
                            <div className="font-medium text-gray-100">Amazon S3</div>
                            <div className="text-xs text-gray-400">AWS, MinIO, LocalStack</div>
                        </div>
                        {provider === 's3' && (
                            <svg className="w-5 h-5 text-orange-400" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                        )}
                    </button>
                    
                    {/* Option GCS */}
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handleProviderChange('gcs')}
                        className={`
                            flex items-center gap-3 p-4 rounded-lg border-2 transition-all duration-200
                            ${provider === 'gcs' 
                                ? 'border-blue-500 bg-blue-500/10' 
                                : 'border-gray-600 bg-gray-700/50 hover:border-gray-500'
                            }
                            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                        `}
                    >
                        <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                            <span className="text-2xl">☁️</span>
                        </div>
                        <div className="flex-1 text-left">
                            <div className="font-medium text-gray-100">Google Cloud</div>
                            <div className="text-xs text-gray-400">Google Cloud Storage</div>
                        </div>
                        {provider === 'gcs' && (
                            <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>
            
            {/* Formulaire spécifique au provider */}
            {provider === 's3' && (
                <S3ConfigForm
                    config={config?.s3 || {}}
                    onChange={handleS3Change}
                    disabled={disabled}
                />
            )}
            
            {provider === 'gcs' && (
                <GCSConfigForm
                    config={config?.gcs || {}}
                    onChange={handleGCSChange}
                    disabled={disabled}
                />
            )}
            
            {/* Bouton test connexion */}
            {onTestConnection && (
                <div className="pt-3 border-t border-gray-700">
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={handleTestConnection}
                            disabled={disabled || testing}
                            className={`
                                flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200
                                ${testing 
                                    ? 'bg-gray-600 text-gray-300 cursor-wait' 
                                    : 'bg-indigo-600 text-white hover:bg-indigo-500'
                                }
                                disabled:opacity-50 disabled:cursor-not-allowed
                            `}
                        >
                            {testing ? (
                                <>
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Test en cours...
                                </>
                            ) : (
                                <>
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                                            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    Tester la connexion
                                </>
                            )}
                        </button>
                        
                        {/* Résultat du test */}
                        {testResult && (
                            <div className={`
                                flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                                ${testResult.success 
                                    ? 'bg-emerald-500/20 text-emerald-300' 
                                    : 'bg-red-500/20 text-red-300'
                                }
                            `}>
                                {testResult.success ? (
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                    </svg>
                                ) : (
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                    </svg>
                                )}
                                <span>{testResult.message}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default CloudStorageConfigForm;
