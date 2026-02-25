import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectUntrackedFileContexts } from "../model-input";

describe("collectUntrackedFileContexts", () => {
  test("includes selected untracked files and truncates long content", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "shipit-model-input-"));
    const previousCwd = process.cwd();

    try {
      process.chdir(tempRoot);
      await writeFile("new-file.ts", "a".repeat(30));

      const result = await collectUntrackedFileContexts({
        filePaths: ["new-file.ts"],
        selectedPaths: [],
        maxCharsPerFile: 10,
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.path).toBe("new-file.ts");
      expect(result[0]?.content).toBe("a".repeat(10));
      expect(result[0]?.isTruncated).toBe(true);
      expect(result[0]?.isBinary).toBe(false);
    } finally {
      process.chdir(previousCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("filters out files outside selected paths", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "shipit-model-input-"));
    const previousCwd = process.cwd();

    try {
      process.chdir(tempRoot);
      await mkdir("src", { recursive: true });
      await mkdir("docs", { recursive: true });
      await writeFile("src/new.ts", "export const x = 1;");
      await writeFile("docs/new.md", "# notes");

      const result = await collectUntrackedFileContexts({
        filePaths: ["src/new.ts", "docs/new.md"],
        selectedPaths: ["src"],
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.path).toBe("src/new.ts");
    } finally {
      process.chdir(previousCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("marks binary content as omitted", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "shipit-model-input-"));
    const previousCwd = process.cwd();

    try {
      process.chdir(tempRoot);
      await writeFile("asset.bin", Buffer.from([0, 1, 2, 3]));

      const result = await collectUntrackedFileContexts({
        filePaths: ["asset.bin"],
        selectedPaths: [],
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.path).toBe("asset.bin");
      expect(result[0]?.isBinary).toBe(true);
      expect(result[0]?.content).toBe("[binary file omitted]");
    } finally {
      process.chdir(previousCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
