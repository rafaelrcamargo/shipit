import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

type ProviderDefinition = {
  providerLabel: string;
  defaultModelId: string;
  defaultModelName: string;
  requiredApiKeyEnv: string;
  createModel: (modelId: string) => LanguageModel;
  options: Record<string, unknown>;
};

export const providerRegistryById = {
  openai: {
    providerLabel: "OpenAI",
    defaultModelId: "gpt-5.6-luna",
    defaultModelName: "GPT-5.6 Luna",
    requiredApiKeyEnv: "OPENAI_API_KEY",
    createModel: (modelId: string) => openai(modelId),
    options: {
      reasoningSummary: null,
      strictJsonSchema: true,
    },
  },
  google: {
    providerLabel: "Google",
    defaultModelId: "gemini-3.6-flash",
    defaultModelName: "Gemini 3.6 Flash",
    requiredApiKeyEnv: "GOOGLE_GENERATIVE_AI_API_KEY",
    createModel: (modelId: string) => google(modelId),
    options: {
      structuredOutputs: true,
      responseModalities: ["TEXT"],
      threshold: "OFF",
    },
  },
  anthropic: {
    providerLabel: "Anthropic",
    defaultModelId: "claude-haiku-4-5",
    defaultModelName: "Claude Haiku 4.5",
    requiredApiKeyEnv: "ANTHROPIC_API_KEY",
    createModel: (modelId: string) => anthropic(modelId),
    options: {},
  },
  groq: {
    providerLabel: "Groq",
    defaultModelId: "openai/gpt-oss-120b",
    defaultModelName: "GPT-OSS 120B",
    requiredApiKeyEnv: "GROQ_API_KEY",
    createModel: (modelId: string) => groq(modelId),
    options: {
      structuredOutputs: true,
      strictJsonSchema: true,
    },
  },
} satisfies Record<string, ProviderDefinition>;
export const defaultGenerationProviderOptions = Object.fromEntries(
  Object.entries(providerRegistryById).map(([providerId, provider]) => [
    providerId,
    provider.options,
  ]),
) as {
  [K in keyof typeof providerRegistryById]: (typeof providerRegistryById)[K]["options"];
};
