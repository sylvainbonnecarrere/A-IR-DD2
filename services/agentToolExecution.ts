import { API_BASE_URL } from '../config/api.config';
import type { Agent, ToolCall, ToolSelection } from '../types';
import type { UserFunction } from '../types/function.types';
import { executeTool } from '../utils/toolExecutor';

export interface ExecutedAgentToolCall {
  result: unknown;
  executedArguments: Record<string, unknown>;
  serializedArguments: string;
  executionId?: string;
  runner?: string;
  exitCode?: number;
  failureKind?: string;
  artifacts?: Array<{ path: string; kind: 'file' | 'json' | 'log' }>;
}

export function parseToolCallArguments(rawArguments: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawArguments);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function buildWebSearchExecutionArgs(args: Record<string, unknown>, agent: Agent): Record<string, unknown> {
  const configuredTopResults = agent.webSearchParams?.web_engine_nb_result_select;
  if (!Number.isFinite(configuredTopResults)) {
    return args;
  }

  return {
    ...args,
    num_results: Math.max(1, Math.trunc(configuredTopResults as number)),
  };
}

export function buildWebSearchPrivateContext(agent: Agent): Record<string, unknown> | undefined {
  if (!agent.webSearchParams) {
    return undefined;
  }

  return {
    web_search: {
      params: agent.webSearchParams,
      llm: {
        provider: agent.llmProvider,
        model: agent.model,
        localLLMProfileId: agent.localLLMProfileId ?? null,
      },
    },
  };
}

async function executeUserFunctionViaSandbox(
  fn: UserFunction,
  args: Record<string, unknown>,
  authToken: string,
  privateContext?: Record<string, unknown>
): Promise<ExecutedAgentToolCall> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  };

  const response = await fetch(`${API_BASE_URL}/api/sandbox/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      functionId: fn._id,
      toolSelection: {
        toolId: fn.toolId ?? fn._id,
        versionRef: {
          versionTag: fn.versionTag,
          versionNumber: fn.version,
          workspaceId: fn.workspaceContext?.workspaceId ?? null,
        },
      } satisfies ToolSelection,
      testArgs: args,
      ...(privateContext ? { privateContext } : {}),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    const errorMessage = typeof payload?.error === 'string'
      ? payload.error
      : typeof payload?.errorDetails?.message === 'string'
        ? payload.errorDetails.message
        : `Sandbox execution failed with HTTP ${response.status}`;
    throw new Error(errorMessage);
  }

  return {
    result: payload.output ?? {},
    executedArguments: args,
    serializedArguments: JSON.stringify(args),
    executionId: payload.executionId,
    runner: payload.runner,
    exitCode: payload.exitCode,
    failureKind: payload.metadata?.failureKind,
    artifacts: payload.metadata?.artifacts,
  };
}

export async function executeAgentToolCall(input: {
  toolCall: ToolCall;
  agent: Agent;
  availableFunctions?: UserFunction[];
  authToken?: string;
}): Promise<ExecutedAgentToolCall> {
  const parsedArguments = parseToolCallArguments(input.toolCall.arguments);
  const executedArguments = input.toolCall.name === 'web_search_py'
    ? buildWebSearchExecutionArgs(parsedArguments, input.agent)
    : parsedArguments;

  const serializedArguments = JSON.stringify(executedArguments);
  const matchedFunction = input.availableFunctions?.find((fn) => fn.isEnabled && fn.name === input.toolCall.name);

  if (matchedFunction && input.authToken) {
    const privateContext = input.toolCall.name === 'web_search_py'
      ? buildWebSearchPrivateContext(input.agent)
      : undefined;

    return executeUserFunctionViaSandbox(matchedFunction, executedArguments, input.authToken, privateContext);
  }

  const toolResult = await executeTool({
    ...input.toolCall,
    arguments: serializedArguments,
  });

  return {
    result: toolResult,
    executedArguments,
    serializedArguments,
  };
}
