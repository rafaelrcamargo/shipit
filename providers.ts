import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { openai } from "@ai-sdk/openai";

/**
 * Detects the available AI provider based on environment variables.
 * Configures the appropriate provider.
 * @returns The AI provider configuration object.
 * @throws Error if a valid API key is not found.
 */
export const detectAndConfigureAIProvider = () => {
  if (process.env["GOOGLE_GENERATIVE_AI_API_KEY"])
    return {
      provider: "Google",
      model: google("gemini-3-flash-preview"),
      name: "Gemini 3 Flash Preview",
    };

  if (process.env["OPENAI_API_KEY"])
    return {
      provider: "OpenAI",
      model: openai("gpt-5.1-codex-mini"),
      name: "GPT-5.1 Codex Mini",
    };

  if (process.env["ANTHROPIC_API_KEY"])
    return {
      provider: "Anthropic",
      model: anthropic("claude-haiku-4-5"),
      name: "Claude Haiku 4.5",
    };

  if (process.env["GROQ_API_KEY"]) {
    return {
      provider: "Groq",
      model: groq("moonshotai/kimi-k2-instruct-0905"),
      name: "Kimi K2 0905",
    };
  }

  throw new Error(
    "No AI provider API key found. Please set one of the following:\n" +
      "- ANTHROPIC_API_KEY for Anthropic models\n" +
      "- OPENAI_API_KEY for OpenAI models\n" +
      "- GROQ_API_KEY for Groq models\n" +
      "- GOOGLE_GENERATIVE_AI_API_KEY for Google Generative AI models",
  );
};
