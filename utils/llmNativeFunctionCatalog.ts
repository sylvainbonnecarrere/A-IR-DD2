import { LLMCapability, LLMProvider } from '../types';

export interface LLMNativeFunctionDefinition {
    capability: LLMCapability;
    name: string;
    description: string;
}

type CatalogEntry = {
    name: string;
    description: (provider?: LLMProvider) => string;
};

const getProviderLabel = (provider?: LLMProvider): string => provider || 'le provider';

const CATALOG: Partial<Record<LLMCapability, CatalogEntry>> = {
    [LLMCapability.FunctionCalling]: {
        name: 'Function Calling',
        description: (provider) => `Autorise ${getProviderLabel(provider)} a orchestrer des appels de fonctions et de tools pendant l'execution.`,
    },
    [LLMCapability.FileUpload]: {
        name: 'File Analysis',
        description: (provider) => `Analyse directement les fichiers transmis via les capacites natives de ${getProviderLabel(provider)}.`,
    },
    [LLMCapability.URLAnalysis]: {
        name: 'URL Analysis',
        description: (provider) => `Analyse le contenu d'une URL sans passer par une fonction applicative externe a ${getProviderLabel(provider)}.`,
    },
    [LLMCapability.ImageGeneration]: {
        name: 'Image Generation',
        description: () => 'Genere des images via les capacites natives du modele selectionne.',
    },
    [LLMCapability.ImageModification]: {
        name: 'Image Modification',
        description: () => 'Modifie ou transforme une image via les capacites natives du modele selectionne.',
    },
    [LLMCapability.WebSearch]: {
        name: 'Web Search',
        description: (provider) => `Declenche une recherche web native disponible sur ${getProviderLabel(provider)}.`,
    },
    [LLMCapability.OutputFormatting]: {
        name: 'Output Formatting',
        description: () => 'Active les sorties structurees et le formatage natif proposes par le provider.',
    },
    [LLMCapability.VideoGeneration]: {
        name: 'Video Generation',
        description: () => 'Genere des videos via les capacites natives du modele selectionne.',
    },
    [LLMCapability.MapsGrounding]: {
        name: 'Maps Grounding',
        description: () => 'Expose une recherche de lieux et un grounding cartographique natifs du provider.',
    },
    [LLMCapability.WebSearchGrounding]: {
        name: 'Web Search Grounding',
        description: () => 'Expose une recherche web avec grounding natif du provider.',
    },
    [LLMCapability.WebFetchTool]: {
        name: 'Web Fetch',
        description: (provider) => `Recupere et injecte le contenu d'une page web via le tool natif de ${getProviderLabel(provider)}.`,
    },
    [LLMCapability.WebSearchToolAnthropic]: {
        name: 'Web Search',
        description: () => 'Effectue une recherche web native executee cote Anthropic.',
    },
};

export function getDisplayableNativeFunctions(
    capabilities: LLMCapability[] | undefined,
    provider?: LLMProvider,
): LLMNativeFunctionDefinition[] {
    const seen = new Set<LLMCapability>();

    return (capabilities || [])
        .filter((capability) => {
            if (!CATALOG[capability] || seen.has(capability)) {
                return false;
            }

            seen.add(capability);
            return true;
        })
        .map((capability) => ({
            capability,
            name: CATALOG[capability]!.name,
            description: CATALOG[capability]!.description(provider),
        }));
}