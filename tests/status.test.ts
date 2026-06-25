import { describe, expect, test } from "bun:test";

const secretEnvNames = [
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "LINEAR_API_KEY",
  "SHIPIT_PROVIDER",
  "SHIPIT_MODEL",
  "SHIPIT_DISABLE_GH",
] as const;

const createEnv = (overrides: Record<string, string> = {}) => {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }

  env["NO_COLOR"] = "1";
  Object.assign(env, overrides);

  for (const name of secretEnvNames) {
    if (!(name in overrides)) {
      delete env[name];
    }
  }

  return env;
};

const runStatus = async (env: Record<string, string | undefined>) => {
  const proc = Bun.spawn(["bun", "run", "index.ts", "status"], {
    cwd: `${import.meta.dir}/..`,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
};

describe("status command", () => {
  test("reports resolved provider and configured keys without printing secrets", async () => {
    const { stdout, stderr, exitCode } = await runStatus(
      createEnv({
        OPENAI_API_KEY: "sk-secret-openai",
        LINEAR_API_KEY: "lin-secret",
        SHIPIT_PROVIDER: "openai",
        SHIPIT_MODEL: "gpt-5.4-mini",
      }),
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("AI Provider");
    expect(stdout).toContain("Item");
    expect(stdout).toMatch(/Provider\s+OpenAI \(openai\)/);
    expect(stdout).toMatch(/Model\s+GPT-5\.4 Mini \(gpt-5\.4-mini\)/);
    expect(stdout).toMatch(/OPENAI_API_KEY\s+configured/);
    expect(stdout).toMatch(/LINEAR_API_KEY\s+configured/);
    expect(stdout).toMatch(/SHIPIT_PROVIDER\s+openai/);
    expect(stdout).toMatch(/SHIPIT_DISABLE_GH\s+unset/);
    expect(stdout).toMatch(/Linear issue details\s+enabled/);
    expect(stdout).toMatch(
      /GitHub context\s+enabled when gh is installed and authenticated/,
    );
    expect(stdout).not.toContain("sk-secret-openai");
    expect(stdout).not.toContain("lin-secret");
  });

  test("is diagnostic when no provider key is configured", async () => {
    const { stdout, stderr, exitCode } = await runStatus(createEnv());

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/Provider\s+not resolved/);
    expect(stdout).toContain("No AI provider API key found");
    expect(stdout).toMatch(/OPENAI_API_KEY\s+missing/);
    expect(stdout).toMatch(
      /Linear issue details\s+disabled; set LINEAR_API_KEY to fetch details/,
    );
    expect(stdout).toMatch(
      /Ticket IDs\s+--ticket values are included even without Linear details/,
    );
  });

  test("reports when GitHub context probing is disabled", async () => {
    const { stdout, stderr, exitCode } = await runStatus(
      createEnv({
        SHIPIT_DISABLE_GH: "1",
      }),
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/SHIPIT_DISABLE_GH\s+1/);
    expect(stdout).toMatch(/GitHub context\s+disabled by SHIPIT_DISABLE_GH=1/);
    expect(stdout).toMatch(/GitHub CLI\s+not checked; SHIPIT_DISABLE_GH=1/);
  });
});
