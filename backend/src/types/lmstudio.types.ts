// Types TypeScript pour le proxy LMStudio

export interface LMStudioEndpointConfig {
  endpoint: string;
  timeout?: number;
}

export interface LMStudioHealthResponse {
  healthy: boolean;
  endpoint?: string;
  models?: number;
  error?: string;
}

export interface LMStudioModelResponse {
  id: string;
  object: string;
  created?: number;
  owned_by?: string;
  context_length?: number;
}

export interface LMStudioModelsListResponse {
  data: LMStudioModelResponse[];
  object: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_call_id?: string;
  }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      /** Schéma JSON de la fonction (JSON Schema). */
      parameters?: Record<string, unknown>;
    };
  }>;
  tool_choice?: 'auto' | 'none';
  response_format?: {
    type: 'json_object' | 'text';
  };
}

export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
