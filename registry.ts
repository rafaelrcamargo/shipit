import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import { anthropic } from "@ai-sdk/anthropic";
import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { google } from "@ai-sdk/google";
import type { GroqProviderOptions } from "@ai-sdk/groq";
import { groq } from "@ai-sdk/groq";
import type { OpenAIChatLanguageModelOptions } from "@ai-sdk/openai";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

type ProviderDefinition = {
  providerLabel: string;
  defaultModelId: string;
  defaultModelName: string;
  requiredApiKeyEnv: string;
  createModel: (modelId: string) => LanguageModel;
  options: unknown;
};

export const providerRegistryById = {
  google: {
    providerLabel: "Google",
    defaultModelId: "gemini-3-flash-preview",
    defaultModelName: "Gemini 3 Flash Preview",
    requiredApiKeyEnv: "GOOGLE_GENERATIVE_AI_API_KEY",
    createModel: (modelId: string) => google(modelId),
    options: {
      thinkingConfig: { thinkingBudget: 0 },
      structuredOutputs: true,
      responseModalities: ["TEXT"],
      threshold: "OFF",
    } satisfies GoogleGenerativeAIProviderOptions,
  },
  openai: {
    providerLabel: "OpenAI",
    defaultModelId: "gpt-5.1-codex-mini",
    defaultModelName: "GPT-5.1 Codex Mini",
    requiredApiKeyEnv: "OPENAI_API_KEY",
    createModel: (modelId: string) => openai(modelId),
    options: {
      reasoningEffort: "low",
      strictJsonSchema: true,
    } satisfies OpenAIChatLanguageModelOptions,
  },
  anthropic: {
    providerLabel: "Anthropic",
    defaultModelId: "claude-haiku-4-5",
    defaultModelName: "Claude Haiku 4.5",
    requiredApiKeyEnv: "ANTHROPIC_API_KEY",
    createModel: (modelId: string) => anthropic(modelId),
    options: {
      thinking: { type: "disabled" },
      sendReasoning: false,
    } satisfies AnthropicProviderOptions,
  },
  groq: {
    providerLabel: "Groq",
    defaultModelId: "moonshotai/kimi-k2-instruct-0905",
    defaultModelName: "Kimi K2 0905",
    requiredApiKeyEnv: "GROQ_API_KEY",
    createModel: (modelId: string) => groq(modelId),
    options: {
      structuredOutputs: true,
      strictJsonSchema: true,
    } satisfies GroqProviderOptions,
  },
} as const satisfies Record<string, ProviderDefinition>;
export const defaultGenerationProviderOptions = Object.fromEntries(
  Object.entries(providerRegistryById).map(([providerId, provider]) => [
    providerId,
    provider.options,
  ]),
) as {
  [K in keyof typeof providerRegistryById]: (typeof providerRegistryById)[K]["options"];
};
