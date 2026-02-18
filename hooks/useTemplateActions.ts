/**
 * @file hooks/useTemplateActions.ts
 * @description Composite hooks pour les actions courantes avec templates
 * @domain Design Domain - Persistence Layer
 * @pattern Facade Pattern - Simplifie l'utilisation complexe de multiples mutations
 */

import { useAuth } from './useAuth';
import {
  useCreateTemplateMutation,
  useUpdateTemplateMutation,
  useDeleteTemplateMutation,
  useToggleTemplateStarMutation,
  useRecordTemplateUsageMutation,
  useTemplatesQuery,
  useTemplateQuery,
} from './useTemplates';
import {
  CreateTemplatePayload,
  UpdateTemplatePayload,
  AgentTemplateDTO,
} from '../services/templateAPI';

// ============================================
// COMPOSITE HOOKS
// ============================================

/**
 * Hook composite pour gérer TOUTES les actions sur templates
 * Centralize la logique de sélection du token dans un seul endroit
 * 
 * @example
 * const actions = useTemplateActions();
 * 
 * // Créer un template
 * await actions.createTemplate(payload);
 * 
 * // Modifier un template
 * await actions.updateTemplate(templateId, updates);
 */
export function useTemplateActions() {
  const { accessToken } = useAuth();

  // Queries
  const templatesQuery = useTemplatesQuery(accessToken);
  const createMutation = useCreateTemplateMutation(accessToken);
  const updateMutation = useUpdateTemplateMutation(accessToken);
  const deleteMutation = useDeleteTemplateMutation(accessToken);
  const starMutation = useToggleTemplateStarMutation(accessToken);
  const usageMutation = useRecordTemplateUsageMutation(accessToken);

  return {
    // Queries
    templates: templatesQuery.data || [],
    isLoadingTemplates: templatesQuery.isLoading,
    templatesError: templatesQuery.error,
    refetchTemplates: templatesQuery.refetch,

    // Create Action
    createTemplate: async (payload: CreateTemplatePayload): Promise<AgentTemplateDTO> => {
      return new Promise((resolve, reject) => {
        createMutation.mutate(payload, {
          onSuccess: resolve,
          onError: reject,
        });
      });
    },
    isCreatingTemplate: createMutation.isPending,
    createError: createMutation.error,

    // Update Action
    updateTemplate: async (
      templateId: string,
      updates: UpdateTemplatePayload
    ): Promise<AgentTemplateDTO> => {
      return new Promise((resolve, reject) => {
        updateMutation.mutate({ templateId, updates }, {
          onSuccess: resolve,
          onError: reject,
        });
      });
    },
    isUpdatingTemplate: updateMutation.isPending,
    updateError: updateMutation.error,

    // Delete Action
    deleteTemplate: async (templateId: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        deleteMutation.mutate(templateId, {
          onSuccess: () => resolve(),
          onError: reject,
        });
      });
    },
    isDeletingTemplate: deleteMutation.isPending,
    deleteError: deleteMutation.error,

    // Star Toggle Action
    toggleTemplateStar: async (templateId: string): Promise<AgentTemplateDTO> => {
      return new Promise((resolve, reject) => {
        starMutation.mutate(templateId, {
          onSuccess: resolve,
          onError: reject,
        });
      });
    },
    isTogglingTemplateStar: starMutation.isPending,
    toggleStarError: starMutation.error,

    // Usage Recording Action
    recordTemplateUsage: async (templateId: string): Promise<AgentTemplateDTO> => {
      return new Promise((resolve, reject) => {
        usageMutation.mutate(templateId, {
          onSuccess: resolve,
          onError: reject,
        });
      });
    },
    isRecordingUsage: usageMutation.isPending,
    recordUsageError: usageMutation.error,
  };
}

// ============================================
// SPECIALIZED HOOKS FOR SPECIFIC PATTERNS
// ============================================

/**
 * Hook pour charger UN template spécifique
 * 
 * @example
 * const { template, isLoading } = useLoadTemplate(templateId);
 */
export function useLoadTemplate(templateId: string | null) {
  const { accessToken } = useAuth();
  const query = useTemplateQuery(templateId, accessToken);

  return {
    template: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Hook pour lister les templates avec filtrage simple
 * Gère la pagination et le sorting automatiquement
 * 
 * @example
 * const { templates, isLoading, nextPage, prevPage } = useListTemplates({
 *   category: 'assistant',
 *   isStarred: true
 * });
 */
export function useListTemplates(filters?: {
  category?: 'assistant' | 'specialist' | 'automation' | 'analysis';
  isStarred?: boolean;
  search?: string;
  sortBy?: 'createdAt' | 'usageCount' | 'name';
  sortOrder?: 'asc' | 'desc';
}) {
  const { accessToken } = useAuth();
  const query = useTemplatesQuery(accessToken, {
    ...filters,
    limit: 10,
    skip: 0,
  });

  return {
    templates: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Hook pour les opérations de création + utilisation (création d'un prototype)
 * 
 * @example
 * const { createAndUseTemplate } = useCreateAndUseTemplate();
 * const newTemplate = await createAndUseTemplate(payload);
 * // À présent, créer un prototype basé sur ce template
 */
export function useCreateAndUseTemplate() {
  const { accessToken } = useAuth();
  const createMutation = useCreateTemplateMutation(accessToken);
  const usageMutation = useRecordTemplateUsageMutation(accessToken);

  return {
    createAndUseTemplate: async (payload: CreateTemplatePayload) => {
      return new Promise<AgentTemplateDTO>((resolve, reject) => {
        createMutation.mutate(payload, {
          onSuccess: async (createdTemplate) => {
            // Automatically record usage
            usageMutation.mutate(createdTemplate._id, {
              onSuccess: resolve,
              onError: reject,
            });
          },
          onError: reject,
        });
      });
    },
    isLoading: createMutation.isPending || usageMutation.isPending,
    error: createMutation.error || usageMutation.error,
  };
}

/**
 * Hook pour les opérations de modification favoris (star/unstar)
 * 
 * @example
 * const { toggleFavorite, isFavorited } = useFavoriteTemplate(templateId, templates);
 * await toggleFavorite();
 */
export function useFavoriteTemplate(
  templateId: string,
  templates: AgentTemplateDTO[] | undefined
) {
  const starMutation = useToggleTemplateStarMutation(useAuth().accessToken);

  const currentTemplate = templates?.find((t) => t._id === templateId);
  const isFavorited = currentTemplate?.isStarred ?? false;

  return {
    isFavorited,
    toggleFavorite: () => starMutation.mutate(templateId),
    isLoading: starMutation.isPending,
    error: starMutation.error,
  };
}

// ============================================
// EXPORTS
// ============================================

export default {
  useTemplateActions,
  useLoadTemplate,
  useListTemplates,
  useCreateAndUseTemplate,
  useFavoriteTemplate,
};
