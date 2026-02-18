/**
 * @file hooks/useTemplates.ts
 * @description React Query hooks pour agent templates (authenticated users)
 * @domain Design Domain - Persistence Layer
 * @scope Utilisateurs CONNECTÉS uniquement (JWT auth required)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AgentTemplateDTO,
  CreateTemplatePayload,
  UpdateTemplatePayload,
  TemplateAPIError,
} from '../services/templateAPI';
import * as templateAPI from '../services/templateAPI';

// ============================================
// QUERY KEYS (For cache invalidation & dev tools)
// ============================================

export const templateQueryKeys = {
  all: ['templates'] as const,
  lists: () => [...templateQueryKeys.all, 'list'] as const,
  list: (filters?: Record<string, any>) =>
    [...templateQueryKeys.lists(), { ...filters }] as const,
  details: () => [...templateQueryKeys.all, 'detail'] as const,
  detail: (id: string) => [...templateQueryKeys.details(), id] as const,
};

// ============================================
// 📖 QUERY: Fetch Templates with Filtering
// ============================================

/**
 * Hook pour récupérer les templates de l'utilisateur avec filtering/pagination
 * 
 * @param accessToken JWT token d'authentification
 * @param options Query options (filters, pagination, sorting)
 * @example
 * const { data: templates, isLoading, error } = useTemplatesQuery(token, {
 *   category: 'assistant',
 *   isStarred: true,
 *   limit: 20
 * });
 */
export function useTemplatesQuery(
  accessToken: string | null | undefined,
  options?: {
    category?: 'assistant' | 'specialist' | 'automation' | 'analysis';
    isStarred?: boolean;
    search?: string;
    limit?: number;
    skip?: number;
    sortBy?: 'createdAt' | 'usageCount' | 'name';
    sortOrder?: 'asc' | 'desc';
  }
) {
  return useQuery({
    queryKey: templateQueryKeys.list(options),
    queryFn: async () => {
      if (!accessToken) {
        throw new TemplateAPIError('Not authenticated', 401);
      }
      return templateAPI.fetchTemplates(accessToken, options);
    },
    enabled: !!accessToken, // Only run if we have a token
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
    retry: 1,
    throwOnError: true,
  });
}

// ============================================
// 📄 QUERY: Fetch Single Template
// ============================================

/**
 * Hook pour récupérer UN template spécifique
 * 
 * @param templateId MongoDB ObjectId du template
 * @param accessToken JWT token d'authentification
 * @example
 * const { data: template, isLoading } = useTemplateQuery(templateId, token);
 */
export function useTemplateQuery(
  templateId: string | null,
  accessToken: string | null | undefined
) {
  return useQuery({
    queryKey: templateQueryKeys.detail(templateId || ''),
    queryFn: async () => {
      if (!templateId || !accessToken) {
        throw new TemplateAPIError('Missing parameters', 400);
      }
      return templateAPI.fetchTemplate(templateId, accessToken);
    },
    enabled: !!templateId && !!accessToken, // Only run if we have both ID and token
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
    throwOnError: true,
  });
}

// ============================================
// ✅ MUTATION: Create Template
// ============================================

/**
 * Mutation hook pour créer un nouveau template
 * 
 * @param accessToken JWT token d'authentification
 * @example
 * const { mutate: createTemplate, isPending } = useCreateTemplateMutation(token);
 * createTemplate({
 *   name: "My Template",
 *   ...,
 *   template: { ... }
 * });
 */
export function useCreateTemplateMutation(accessToken: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateTemplatePayload) => {
      if (!accessToken) {
        throw new TemplateAPIError('Not authenticated', 401);
      }
      return templateAPI.createTemplate(payload, accessToken);
    },
    onSuccess: (newTemplate) => {
      // Invalidate lists (templates list will refetch)
      queryClient.invalidateQueries({
        queryKey: templateQueryKeys.lists(),
      });
      // Add new template to cache
      queryClient.setQueryData(
        templateQueryKeys.detail(newTemplate._id),
        newTemplate
      );
    },
    onError: (error) => {
      console.error('[useCreateTemplateMutation] Error:', error);
    },
    throwOnError: false, // Mutations don't throw by default
  });
}

// ============================================
// ✏️ MUTATION: Update Template
// ============================================

/**
 * Mutation hook pour mettre à jour un template existant
 * 
 * @param accessToken JWT token d'authentification
 * @example
 * const { mutate: updateTemplate } = useUpdateTemplateMutation(token);
 * updateTemplate({
 *   templateId: "...",
 *   updates: { name: "New Name" }
 * });
 */
export function useUpdateTemplateMutation(accessToken: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { templateId: string; updates: UpdateTemplatePayload }) => {
      if (!accessToken) {
        throw new TemplateAPIError('Not authenticated', 401);
      }
      return templateAPI.updateTemplate(
        params.templateId,
        params.updates,
        accessToken
      );
    },
    onSuccess: (updatedTemplate) => {
      // Update specific template in cache
      queryClient.setQueryData(
        templateQueryKeys.detail(updatedTemplate._id),
        updatedTemplate
      );
      // Invalidate lists so they update
      queryClient.invalidateQueries({
        queryKey: templateQueryKeys.lists(),
      });
    },
    onError: (error) => {
      console.error('[useUpdateTemplateMutation] Error:', error);
    },
  });
}

// ============================================
// 🗑️ MUTATION: Delete Template
// ============================================

/**
 * Mutation hook pour supprimer un template
 * 
 * @param accessToken JWT token d'authentification
 * @example
 * const { mutate: deleteTemplate } = useDeleteTemplateMutation(token);
 * deleteTemplate("templateId");
 */
export function useDeleteTemplateMutation(accessToken: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (templateId: string) => {
      if (!accessToken) {
        throw new TemplateAPIError('Not authenticated', 401);
      }
      await templateAPI.deleteTemplate(templateId, accessToken);
      return templateId; // Return ID for optimistic update
    },
    onSuccess: (templateId) => {
      // Remove from cache
      queryClient.removeQueries({
        queryKey: templateQueryKeys.detail(templateId),
      });
      // Invalidate lists
      queryClient.invalidateQueries({
        queryKey: templateQueryKeys.lists(),
      });
    },
    onError: (error) => {
      console.error('[useDeleteTemplateMutation] Error:', error);
    },
  });
}

// ============================================
// ⭐ MUTATION: Toggle Template Star
// ============================================

/**
 * Mutation hook pour toggle isStarred d'un template
 * 
 * @param accessToken JWT token d'authentification
 * @example
 * const { mutate: toggleStar } = useToggleTemplateStarMutation(token);
 * toggleStar("templateId");
 */
export function useToggleTemplateStarMutation(accessToken: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (templateId: string) => {
      if (!accessToken) {
        throw new TemplateAPIError('Not authenticated', 401);
      }
      return templateAPI.toggleTemplateStar(templateId, accessToken);
    },
    onSuccess: (updatedTemplate) => {
      // Update in cache
      queryClient.setQueryData(
        templateQueryKeys.detail(updatedTemplate._id),
        updatedTemplate
      );
      // Invalidate lists (sorting by star may have changed)
      queryClient.invalidateQueries({
        queryKey: templateQueryKeys.lists(),
      });
    },
    onError: (error) => {
      console.error('[useToggleTemplateStarMutation] Error:', error);
    },
  });
}

// ============================================
// 📊 MUTATION: Record Template Usage
// ============================================

/**
 * Mutation hook pour incrémenter usage count d'un template
 * Appelé quand un template est utilisé pour créer un prototype
 * 
 * @param accessToken JWT token d'authentification
 * @example
 * const { mutate: recordUsage } = useRecordTemplateUsageMutation(token);
 * recordUsage("templateId"); // usageCount ++
 */
export function useRecordTemplateUsageMutation(
  accessToken: string | null | undefined
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (templateId: string) => {
      if (!accessToken) {
        throw new TemplateAPIError('Not authenticated', 401);
      }
      return templateAPI.recordTemplateUsage(templateId, accessToken);
    },
    onSuccess: (updatedTemplate) => {
      // Update in cache
      queryClient.setQueryData(
        templateQueryKeys.detail(updatedTemplate._id),
        updatedTemplate
      );
      // Invalidate lists (pagination may have changed due to sort)
      queryClient.invalidateQueries({
        queryKey: templateQueryKeys.lists(),
      });
    },
    onError: (error) => {
      console.error('[useRecordTemplateUsageMutation] Error:', error);
    },
  });
}

// ============================================
// EXPORTS
// ============================================

export default {
  useTemplatesQuery,
  useTemplateQuery,
  useCreateTemplateMutation,
  useUpdateTemplateMutation,
  useDeleteTemplateMutation,
  useToggleTemplateStarMutation,
  useRecordTemplateUsageMutation,
  templateQueryKeys,
};
