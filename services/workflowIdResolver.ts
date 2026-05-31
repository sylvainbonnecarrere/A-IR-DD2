interface DesignWorkflowIdentity {
  _id: string;
  isActive?: boolean;
}

interface ResolveActiveWorkflowIdParams {
  designWorkflowId: string | null | undefined;
  designWorkflows?: DesignWorkflowIdentity[];
  legacyWorkflowId?: string | null | undefined;
}

function normalizeWorkflowId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveActiveWorkflowId({
  designWorkflowId,
  designWorkflows = [],
  legacyWorkflowId,
}: ResolveActiveWorkflowIdParams): string | null {
  const explicitDesignWorkflowId = normalizeWorkflowId(designWorkflowId);
  if (explicitDesignWorkflowId) {
    return explicitDesignWorkflowId;
  }

  const activeDesignWorkflowId = designWorkflows
    .map((workflow) => (workflow.isActive ? normalizeWorkflowId(workflow._id) : null))
    .find((workflowId): workflowId is string => Boolean(workflowId));
  if (activeDesignWorkflowId) {
    return activeDesignWorkflowId;
  }

  const firstDesignWorkflowId = designWorkflows
    .map((workflow) => normalizeWorkflowId(workflow._id))
    .find((workflowId): workflowId is string => Boolean(workflowId));
  if (firstDesignWorkflowId) {
    return firstDesignWorkflowId;
  }

  return normalizeWorkflowId(legacyWorkflowId);
}