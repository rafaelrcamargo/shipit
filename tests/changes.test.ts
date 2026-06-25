import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { simpleGit } from "simple-git";

import {
  collectChangeSet,
  getChangeSetDrift,
  getPathspecsForChangeIds,
  parsePorcelainV2,
  validateCommitCoverage,
} from "../changes";

async function createTempRepo() {
  const root = await mkdtemp(join(tmpdir(), "shipit-changes-"));
  const git = simpleGit(root);

  await git.init();
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test User");
  await writeFile(join(root, "base.txt"), "base\n");
  await writeFile(join(root, "delete-me.txt"), "delete\n");
  await writeFile(join(root, "rename-me.txt"), "rename\n");
  await git.add(["base.txt", "delete-me.txt", "rename-me.txt"]);
  await git.commit("base");

  return { root, git };
}

describe("parsePorcelainV2", () => {
  test("parses modified, added, deleted, renamed, copied, untracked, and conflicted entries", () => {
    const output = [
      "1 .M N... 100644 100644 100644 hhhhh iiiii src/modified.ts",
      "1 MM N... 100644 100644 100644 hhhhh iiiii src/staged-and-unstaged.ts",
      "1 A. N... 000000 100644 100644 00000 aaaaa src/added.ts",
      "1 D. N... 100644 000000 000000 ddddd 00000 src/deleted.ts",
      "2 R. N... 100644 100644 100644 ooooo nnnnn R100 src/new.ts",
      "src/old.ts",
      "2 C. N... 100644 100644 100644 ooooo nnnnn C090 src/copy.ts",
      "src/source.ts",
      "? src/untracked.ts",
      "u UU N... 100644 100644 100644 100644 aaaaa bbbbb ccccc src/conflict.ts",
      "",
    ].join("\0");

    const entries = parsePorcelainV2(output);

    expect(entries).toEqual([
      expect.objectContaining({ type: "ordinary", path: "src/modified.ts" }),
      expect.objectContaining({
        type: "ordinary",
        xy: "MM",
        path: "src/staged-and-unstaged.ts",
      }),
      expect.objectContaining({ type: "ordinary", path: "src/added.ts" }),
      expect.objectContaining({ type: "ordinary", path: "src/deleted.ts" }),
      expect.objectContaining({
        type: "renamed",
        path: "src/new.ts",
        fromPath: "src/old.ts",
      }),
      expect.objectContaining({
        type: "renamed",
        path: "src/copy.ts",
        fromPath: "src/source.ts",
      }),
      expect.objectContaining({ type: "untracked", path: "src/untracked.ts" }),
      expect.objectContaining({ type: "unmerged", path: "src/conflict.ts" }),
    ]);
  });
});

describe("collectChangeSet", () => {
  const untrackedSelectionCases = [
    { label: "no args", args: [] },
    { label: "shipit .", args: ["."] },
    { label: "shipit ./src", args: ["./src"] },
    { label: "shipit src/", args: ["src/"] },
    { label: "shipit src/new.ts", args: ["src/new.ts"] },
  ];

  for (const { label, args } of untrackedSelectionCases) {
    test(`includes untracked files for ${label}`, async () => {
      const { root, git } = await createTempRepo();

      try {
        await mkdir(join(root, "src"), { recursive: true });
        await writeFile(join(root, "src", "new.ts"), "export const x = 1;\n");

        const changeSet = await collectChangeSet(git, args);

        expect(changeSet.changes).toHaveLength(1);
        expect(changeSet.changes[0]).toMatchObject({
          id: "C001",
          kind: "untracked",
          path: "src/new.ts",
          stagePathspecs: ["src/new.ts"],
          commitPathspecs: ["src/new.ts"],
        });
        expect(changeSet.changes[0]?.evidence.content).toContain("export");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  test("maps selected rename sides back to one rename change with both pathspecs", async () => {
    const { root, git } = await createTempRepo();

    try {
      await git.mv("rename-me.txt", "renamed.txt");

      const changeSet = await collectChangeSet(git, ["renamed.txt"]);

      expect(changeSet.changes).toHaveLength(1);
      expect(changeSet.changes[0]).toMatchObject({
        id: "C001",
        kind: "renamed",
        fromPath: "rename-me.txt",
        path: "renamed.txt",
        stagePathspecs: ["renamed.txt"],
        commitPathspecs: ["rename-me.txt", "renamed.txt"],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("detects staged renames outside selected paths", async () => {
    const { root, git } = await createTempRepo();

    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(
        join(root, "src", "selected.ts"),
        "export const x = 1;\n",
      );
      await git.mv("rename-me.txt", "renamed.txt");

      const changeSet = await collectChangeSet(git, ["src"]);

      expect(changeSet.changes.map((change) => change.path)).toEqual([
        "src/selected.ts",
      ]);
      expect(changeSet.stagedOutsideSelectedChanges).toHaveLength(1);
      expect(changeSet.stagedOutsideSelectedChanges[0]).toMatchObject({
        kind: "renamed",
        fromPath: "rename-me.txt",
        path: "renamed.txt",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("commits rename changes using both old and new pathspecs", async () => {
    const { root, git } = await createTempRepo();

    try {
      await git.mv("rename-me.txt", "renamed.txt");
      const changeSet = await collectChangeSet(git, ["renamed.txt"]);
      const changeIds = changeSet.changes.map((change) => change.id);
      const stagePathspecs = getPathspecsForChangeIds(
        changeSet,
        changeIds,
        "stagePathspecs",
      );
      const commitPathspecs = getPathspecsForChangeIds(
        changeSet,
        changeIds,
        "commitPathspecs",
      );

      await git.raw(["add", "-A", "--", ...stagePathspecs]);
      await git.commit("test: rename file", commitPathspecs);

      const status = await git.status();
      expect(status.isClean()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("commits deleted files using their deleted pathspec", async () => {
    const { root, git } = await createTempRepo();

    try {
      await rm(join(root, "delete-me.txt"));
      const changeSet = await collectChangeSet(git, ["delete-me.txt"]);
      const changeIds = changeSet.changes.map((change) => change.id);

      await git.raw([
        "add",
        "-A",
        "--",
        ...getPathspecsForChangeIds(changeSet, changeIds, "stagePathspecs"),
      ]);
      await git.commit(
        "test: delete file",
        getPathspecsForChangeIds(changeSet, changeIds, "commitPathspecs"),
      );

      const status = await git.status();
      expect(status.isClean()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("detects drift after evidence collection", async () => {
    const { root, git } = await createTempRepo();

    try {
      await writeFile(join(root, "base.txt"), "changed once\n");
      const original = await collectChangeSet(git, ["base.txt"]);
      await writeFile(join(root, "base.txt"), "changed twice\n");
      const current = await collectChangeSet(git, ["base.txt"]);

      expect(
        getChangeSetDrift(
          original,
          current,
          original.changes.map((change) => change.id),
        ),
      ).toEqual(["C001 modified: base.txt changed"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("validateCommitCoverage", () => {
  test("accepts exact one-time change coverage", () => {
    const result = validateCommitCoverage(
      [{ changeIds: ["C001"] }, { changeIds: ["C002"] }],
      ["C001", "C002"],
    );

    expect(result).toEqual({
      ok: true,
      missing: [],
      duplicated: [],
      unexpected: [],
    });
  });

  test("reports missing changes", () => {
    const result = validateCommitCoverage(
      [{ changeIds: ["C001"] }],
      ["C001", "C002"],
    );

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["C002"]);
    expect(result.duplicated).toEqual([]);
    expect(result.unexpected).toEqual([]);
  });

  test("reports duplicated changes", () => {
    const result = validateCommitCoverage(
      [{ changeIds: ["C001"] }, { changeIds: ["C001"] }],
      ["C001"],
    );

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.duplicated).toEqual(["C001"]);
    expect(result.unexpected).toEqual([]);
  });

  test("reports invented changes", () => {
    const result = validateCommitCoverage(
      [{ changeIds: ["C001", "C003"] }],
      ["C001"],
    );

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.duplicated).toEqual([]);
    expect(result.unexpected).toEqual(["C003"]);
  });
});
