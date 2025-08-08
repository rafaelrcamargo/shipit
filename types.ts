import type { createAnthropic } from "@ai-sdk/anthropic";
import type { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { simpleGit } from "simple-git";
import type { createPrompts } from "./prompts";

export type Log = ReturnType<typeof createPrompts>["log"];
export type Spinner = ReturnType<typeof createPrompts>["spinner"];
export type Confirm = ReturnType<typeof createPrompts>["confirm"];
export type Git = ReturnType<typeof simpleGit>;

// AI Provider types
export type GoogleProvider = ReturnType<typeof createGoogleGenerativeAI>;
export type AnthropicProvider = ReturnType<typeof createAnthropic>;
export type OpenAIProvider = ReturnType<typeof createOpenAI>;

export type AIProvider = GoogleProvider | AnthropicProvider | OpenAIProvider;

export type AIProviderConfig = {
  provider: string;
  model: LanguageModel;
  name: string;
};

export type BaseHandlerParams = {
  git: Git;
  log: Log;
  spinner: Spinner;
};

export type PushHandlerParams = BaseHandlerParams;

export type PrHandlerParams = BaseHandlerParams & {
  confirm: Confirm;
  options: { [key: string]: boolean };
  aiConfig: AIProviderConfig;
};
