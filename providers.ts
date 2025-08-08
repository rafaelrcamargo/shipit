import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";

/**
 * Detects the available AI provider based on environment variables.
 * Configures the appropriate provider.
 * @returns The AI provider configuration object.
 * @throws Error if a valid API key is not found.
 */
export const detectAndConfigureAIProvider = () => {
  if (process.env["OPENAI_API_KEY"])
    return {
      provider: "OpenAI",
      model: openai("gpt-5-nano"),
      name: "GPT-5 Nano",
    };

  if (process.env["ANTHROPIC_API_KEY"])
    return {
      provider: "Anthropic",
      model: anthropic("claude-sonnet-4-20250514"),
      name: "Claude Sonnet 4",
    };

  if (process.env["GOOGLE_GENERATIVE_AI_API_KEY"])
    return {
      provider: "Google",
      model: google("gemini-2.5-flash"),
      name: "Gemini 2.5 Flash",
    };

  throw new Error(
    "No AI provider API key found. Please set one of the following:\n" +
      "- ANTHROPIC_API_KEY for Anthropic models\n" +
      "- OPENAI_API_KEY for OpenAI models\n" +
      "- GOOGLE_GENERATIVE_AI_API_KEY for Google Generative AI models",
  );
};
