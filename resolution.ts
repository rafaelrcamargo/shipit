import type { LanguageModel } from "ai";

import { providerRegistryById } from "./registry";

type ProviderId = keyof typeof providerRegistryById;
type RegisteredProvider = (typeof providerRegistryById)[ProviderId];
type ProviderApiKeyEnv = RegisteredProvider["requiredApiKeyEnv"];

const PROVIDER_ENV = "SHIPIT_PROVIDER";
const MODEL_ENV = "SHIPIT_MODEL";
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/-]+$/;

const providerRegistryEntries = Object.entries(providerRegistryById) as Array<
  [ProviderId, RegisteredProvider]
>;

const listSupportedProviders = () =>
  Object.keys(providerRegistryById).join(", ");

const isProviderId = (value: string): value is ProviderId =>
  Object.hasOwn(providerRegistryById, value);

const assertApiKeyAvailable = (
  providerId: ProviderId,
  provider: RegisteredProvider,
) => {
  if (process.env[provider.requiredApiKeyEnv]) return;

  throw new Error(
    `Missing API key for ${provider.providerLabel}. Set \`${provider.requiredApiKeyEnv}\` before using \`${PROVIDER_ENV}=${providerId}\`.`,
  );
};

export type ResolvedProviderConfig = {
  id: ProviderId;
  provider: string;
  model: LanguageModel;
  modelId: string;
  name: string;
  requiredApiKeyEnv: ProviderApiKeyEnv;
};

const createResolution = (
  providerId: ProviderId,
  provider: RegisteredProvider,
  modelId: string,
): ResolvedProviderConfig => {
  if (!MODEL_ID_PATTERN.test(modelId)) {
    throw new Error(
      `Invalid \`${MODEL_ENV}\` value \`${modelId}\`. Use only letters, numbers, ".", "_", "-", "/", and ":".`,
    );
  }

  try {
    const model = provider.createModel(modelId);
    const isDefaultModel = modelId === provider.defaultModelId;

    return {
      id: providerId,
      provider: provider.providerLabel,
      model,
      modelId,
      name: isDefaultModel ? provider.defaultModelName : modelId,
      requiredApiKeyEnv: provider.requiredApiKeyEnv,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid model \`${modelId}\` for ${provider.providerLabel}. Check \`${MODEL_ENV}\` and provider compatibility. ${message}`,
    );
  }
};

export const resolveProviderConfig = (): ResolvedProviderConfig => {
  const providerOverrideRaw = process.env[PROVIDER_ENV];
  const modelOverrideRaw = process.env[MODEL_ENV];
  const providerOverride = providerOverrideRaw?.trim().toLowerCase();
  const modelOverride = modelOverrideRaw?.trim();

  if (providerOverrideRaw !== undefined && providerOverride === "") {
    throw new Error(
      `\`${PROVIDER_ENV}\` cannot be empty. Provide one of: ${listSupportedProviders()}.`,
    );
  }

  if (modelOverrideRaw !== undefined && modelOverride === "") {
    throw new Error(
      `\`${MODEL_ENV}\` cannot be empty. Provide a model id or unset the variable.`,
    );
  }

  if (modelOverrideRaw !== undefined && !providerOverride) {
    throw new Error(
      `\`${MODEL_ENV}\` requires \`${PROVIDER_ENV}\` to be set. Example: \`${PROVIDER_ENV}=openai ${MODEL_ENV}=gpt-5.1-codex-mini\`.`,
    );
  }

  if (providerOverride) {
    if (!isProviderId(providerOverride)) {
      throw new Error(
        `Invalid \`${PROVIDER_ENV}\` value \`${providerOverride}\`. Supported providers: ${listSupportedProviders()}.`,
      );
    }

    const providerId = providerOverride;
    const provider = providerRegistryById[providerId];
    assertApiKeyAvailable(providerId, provider);

    return createResolution(
      providerId,
      provider,
      modelOverride || provider.defaultModelId,
    );
  }

  for (const [providerId, provider] of providerRegistryEntries) {
    if (!process.env[provider.requiredApiKeyEnv]) continue;
    return createResolution(providerId, provider, provider.defaultModelId);
  }

  throw new Error(
    "No AI provider API key found. Set one of the following:\n" +
      providerRegistryEntries
        .map(([, provider]) => `- ${provider.requiredApiKeyEnv}`)
        .join("\n"),
  );
};
