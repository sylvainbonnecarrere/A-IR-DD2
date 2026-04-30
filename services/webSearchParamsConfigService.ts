import type { AgentInstance, WebSearchParams } from '../types';
import { API_BASE_URL } from '../config/api.config';
import { buildGovernanceHeaders } from '../utils/governanceHeaders';

export async function persistInstanceWebSearchParams(
  instance: AgentInstance,
  webSearchParams: WebSearchParams,
  accessToken?: string | null
): Promise<void> {
  if (!accessToken || !instance.id || !instance.configuration_json) {
    return;
  }

  const response = await fetch(`${API_BASE_URL}/api/agent-instances/${instance.id}`, {
    method: 'PUT',
    headers: buildGovernanceHeaders(accessToken, {
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      configuration_json: {
        ...instance.configuration_json,
        webSearchParams,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to persist webSearchParams for agent instance ${instance.id}`);
  }
}