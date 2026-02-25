import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";

import { providerRegistryById } from "../registry";
import { resolveProviderConfig } from "../resolution";

const MANAGED_ENV_KEYS = [
  "SHIPIT_PROVIDER",
  "SHIPIT_MODEL",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
] as const;

type ManagedEnvKey = (typeof MANAGED_ENV_KEYS)[number];

const originalEnv = new Map<ManagedEnvKey, string | undefined>();

beforeAll(() => {
  for (const key of MANAGED_ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
  }
});

beforeEach(() => {
  for (const key of MANAGED_ENV_KEYS) {
    delete process.env[key];
  }
});

afterAll(() => {
  for (const key of MANAGED_ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
});

describe("resolveProviderConfig", () => {
  test("uses fallback key detection order (google first)", () => {
    process.env["GOOGLE_GENERATIVE_AI_API_KEY"] = "google-key";
    process.env["OPENAI_API_KEY"] = "openai-key";

    const resolved = resolveProviderConfig();
    expect(resolved.id).toBe("google");
    expect(resolved.modelId).toBe(
      providerRegistryById["google"].defaultModelId,
    );
  });

  test("uses provider default model when provider is forced without model", () => {
    process.env["SHIPIT_PROVIDER"] = "openai";
    process.env["OPENAI_API_KEY"] = "openai-key";

    const resolved = resolveProviderConfig();
    expect(resolved.id).toBe("openai");
    expect(resolved.modelId).toBe(
      providerRegistryById["openai"].defaultModelId,
    );
  });

  test("uses explicit model when provider and model are both set", () => {
    process.env["SHIPIT_PROVIDER"] = "openai";
    process.env["SHIPIT_MODEL"] = "gpt-5.4";
    process.env["OPENAI_API_KEY"] = "openai-key";

    const resolved = resolveProviderConfig();
    expect(resolved.id).toBe("openai");
    expect(resolved.modelId).toBe("gpt-5.4");
    expect(resolved.name).toBe("gpt-5.4");
  });

  test("fails when SHIPIT_MODEL is set without SHIPIT_PROVIDER", () => {
    process.env["SHIPIT_MODEL"] = "gpt-5.4";
    process.env["OPENAI_API_KEY"] = "openai-key";

    expect(() => resolveProviderConfig()).toThrow(
      "`SHIPIT_MODEL` requires `SHIPIT_PROVIDER` to be set.",
    );
  });

  test("fails when SHIPIT_PROVIDER is present but empty", () => {
    process.env["SHIPIT_PROVIDER"] = "   ";
    process.env["OPENAI_API_KEY"] = "openai-key";

    expect(() => resolveProviderConfig()).toThrow(
      "`SHIPIT_PROVIDER` cannot be empty.",
    );
  });

  test("fails when SHIPIT_MODEL is present but empty", () => {
    process.env["SHIPIT_MODEL"] = "   ";
    process.env["OPENAI_API_KEY"] = "openai-key";

    expect(() => resolveProviderConfig()).toThrow(
      "`SHIPIT_MODEL` cannot be empty.",
    );
  });

  test("fails fast on invalid provider values", () => {
    process.env["SHIPIT_PROVIDER"] = "not-a-provider";
    process.env["OPENAI_API_KEY"] = "openai-key";

    expect(() => resolveProviderConfig()).toThrow(
      "Invalid `SHIPIT_PROVIDER` value `not-a-provider`.",
    );
  });

  test("rejects prototype-pollution style provider values", () => {
    process.env["SHIPIT_PROVIDER"] = "__proto__";
    process.env["OPENAI_API_KEY"] = "openai-key";

    expect(() => resolveProviderConfig()).toThrow(
      "Invalid `SHIPIT_PROVIDER` value `__proto__`.",
    );
  });

  test("fails when forced provider key is missing", () => {
    process.env["SHIPIT_PROVIDER"] = "openai";

    expect(() => resolveProviderConfig()).toThrow(
      "Missing API key for OpenAI. Set `OPENAI_API_KEY` before using `SHIPIT_PROVIDER=openai`.",
    );
  });

  test("fails when model contains invalid characters", () => {
    process.env["SHIPIT_PROVIDER"] = "openai";
    process.env["SHIPIT_MODEL"] = "gpt-5.4?";
    process.env["OPENAI_API_KEY"] = "openai-key";

    expect(() => resolveProviderConfig()).toThrow(
      "Invalid `SHIPIT_MODEL` value `gpt-5.4?`.",
    );
  });

  test("fails when no provider api key is configured", () => {
    expect(() => resolveProviderConfig()).toThrow(
      "No AI provider API key found. Set one of the following:",
    );
  });
});
