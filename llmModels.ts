import { LLMProvider } from './types';

export const LLM_MODELS: Record<LLMProvider, string[]> = {
    [LLMProvider.Gemini]: [
        'gemini-2.5-flash', // Recommended for general chat/text tasks
    ],
    [LLMProvider.OpenAI]: [
        'gpt-4o', // Recommended: Fast, intelligent, multimodal, function calling
        'gpt-4-turbo',
        'gpt-3.5-turbo',
    ],
    [LLMProvider.Mistral]: [
        'codestral-latest', // New model for code
        'devstral-small-latest', // New developer model
        'devstral-medium-latest', // New developer model
        'mistral-large-latest', // Recommended
        'mistral-small-latest',
        'open-mistral-nemo', // Newest open model
    ],
    [LLMProvider.Anthropic]: [
        'claude-3-5-sonnet-20240620', // Recommended: Latest and most intelligent
        'claude-3-opus-20240229',
        'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307',
    ],
    [LLMProvider.Grok]: [
        'grok-1.5', // Recommended, Vision capabilities
        'grok-1.5-lora',
        'grok-1',
    ],
    [LLMProvider.Perplexity]: [
        'llama-3-sonar-small-32k-chat',
        'llama-3-sonar-small-32k-online',
        'llama-3-sonar-large-32k-chat',
        'llama-3-sonar-large-32k-online', // Recommended: With web search
    ],
    [LLMProvider.Qwen]: [
        'qwen-max', // Recommended
        'qwen-plus',
        'qwen-vl-plus', // Vision
    ],
    [LLMProvider.Kimi]: [
        'moonshot-v1-128k', // Recommended
        'moonshot-v1-32k',
        'moonshot-v1-8k',
    ],
    [LLMProvider.DeepSeek]: [
        'deepseek-reasoner', // Recommended: R1 Reasoning model
        'deepseek-chat', // V3.2-Exp general purpose
        'deepseek-coder', // Specialized for coding
    ],
    [LLMProvider.LMStudio]: [
        'qwen2.5-coder-7b', // Recommended: Alibaba coding specialist
        'gemma3-8b-instruct', // Google general purpose
        'gemma3-2b-instruct', // Efficient edge model
        'llama-3.2-1b', // Meta efficient model
        'llama-3.2-3b', // Meta balanced model
    ],
    [LLMProvider.ArcLLM]: [
        'arc-video-v1', // Arc-LLM Video Generation Model
        'arc-grounding-v1', // Arc-LLM Grounding (Maps + Web Search)
    ],
};