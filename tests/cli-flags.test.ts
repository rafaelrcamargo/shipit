import { describe, expect, test } from "bun:test";

describe("CLI flags contract", () => {
  test("--help exposes expected flags and hides removed ones", async () => {
    const proc = Bun.spawn(["bun", "run", "index.ts", "--help"], {
      cwd: `${import.meta.dir}/..`,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    expect(stdout).toMatch(/--yes\b/);
    expect(stdout).toMatch(/--skip-token-check\b/);
    expect(stdout).toMatch(/--push\b/);
    expect(stdout).toMatch(/--pr\b/);
    expect(stdout).toMatch(/--pull-request\b/);
    expect(stdout).toMatch(/--ticket\b/);
    expect(stdout).toMatch(/--context\b/);
    expect(stdout).toMatch(/\bstatus\b/);

    expect(stdout).not.toMatch(/--force\b/);
    expect(stdout).not.toMatch(/--unsafe\b/);
    expect(stdout).not.toMatch(/--appendix\b/);
    expect(stdout).not.toMatch(/--silent\b/);
  });
});
