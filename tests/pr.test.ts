import { afterEach, describe, expect, test } from "bun:test";
import {
  lstat,
  mkdtemp,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prInstruction } from "../constants";
import type { ChangedFileContext, RepoContext } from "../context";
import {
  buildPullRequestCreateCommand,
  findPullRequestUrl,
  getPullRequestAttachmentCandidates,
  getPullRequestPushState,
  resolvePullRequestAttachments,
  supportsPullRequestAttachments,
} from "../pr";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

const changedFile = (path: string): ChangedFileContext => ({
  path,
  status: "M",
  isBinary: true,
  isNoisy: false,
});

const emptyRepoContext: RepoContext = {
  ticketIds: [],
  commits: [],
  diff: {},
  changedFiles: [],
  github: { isAvailable: false, linkedIssues: [] },
  linear: { isAvailable: false, issues: [] },
  omittedReasons: [],
};

describe("getPullRequestPushState", () => {
  test("reports up-to-date branches", async () => {
    const calls: string[][] = [];
    const state = await getPullRequestPushState(async (args) => {
      calls.push(args);
      return { total: 0 };
    }, "feature/test");

    expect(state).toEqual({ status: "up-to-date" });
    expect(calls).toEqual([["origin/feature/test..HEAD", "--oneline"]]);
  });

  test("reports unpushed commits", async () => {
    const state = await getPullRequestPushState(
      async () => ({ total: 2 }),
      "feature/test",
    );

    expect(state).toEqual({ status: "needs-push", commitCount: 2 });
  });

  test("reports first-push branches when the remote branch is missing", async () => {
    const state = await getPullRequestPushState(async () => {
      throw new Error(
        "fatal: ambiguous argument 'origin/feature/test..HEAD': unknown revision or path not in the working tree",
      );
    }, "feature/test");

    expect(state).toEqual({ status: "needs-first-push" });
  });

  test("rethrows remote errors that are not missing tracking branches", async () => {
    await expect(
      getPullRequestPushState(async () => {
        throw new Error("Authentication failed");
      }, "feature/test"),
    ).rejects.toThrow("Authentication failed");
  });
});

describe("PR attachments", () => {
  test("detects attachment support from gh help", async () => {
    const supported = await supportsPullRequestAttachments(async (args) => {
      expect(args).toEqual(["pr", "create", "--help"]);
      return {
        code: 0,
        stdout: "FLAGS\n      --attach file   Attach a file",
        stderr: "",
      };
    });

    expect(supported).toBe(true);
    expect(
      await supportsPullRequestAttachments(async () => ({
        code: 0,
        stdout: "FLAGS\n      --title string",
        stderr: "",
      })),
    ).toBe(false);
    expect(
      await supportsPullRequestAttachments(async () => {
        throw new Error("gh is unavailable");
      }),
    ).toBe(false);
  });

  test("offers only safe files accepted by gh", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "shipit-pr-attachments-"));
    temporaryDirectories.push(repoRoot);

    await writeFile(join(repoRoot, "wide.png"), "image");
    await writeFile(join(repoRoot, "empty.jpg"), "");
    await writeFile(join(repoRoot, "large.webp"), "image");
    await truncate(join(repoRoot, "large.webp"), 10 * 1024 * 1024 + 1);
    await writeFile(join(repoRoot, "clip.mp4"), "video");
    await writeFile(join(repoRoot, "notes.txt"), "text");
    await writeFile(join(repoRoot, "fragment#name.png"), "image");
    await symlink(join(repoRoot, "wide.png"), join(repoRoot, "linked.png"));

    const candidates = await getPullRequestAttachmentCandidates(repoRoot, [
      changedFile("wide.png"),
      changedFile("empty.jpg"),
      changedFile("large.webp"),
      changedFile("clip.mp4"),
      changedFile("notes.txt"),
      changedFile("fragment#name.png"),
      changedFile("linked.png"),
      changedFile("missing.gif"),
      changedFile("../outside.png"),
    ]);

    expect(candidates).toEqual(["./wide.png", "./clip.mp4"]);
    expect((await lstat(join(repoRoot, "linked.png"))).isSymbolicLink()).toBe(
      true,
    );
  });

  test("accepts exact candidates and rejects invented paths", () => {
    expect(
      resolvePullRequestAttachments(
        ["./wide.png", "./wide.png"],
        ["./wide.png"],
      ),
    ).toEqual(["./wide.png"]);
    expect(() =>
      resolvePullRequestAttachments(["./other.png"], ["./wide.png"]),
    ).toThrow("AI selected an unavailable PR attachment: ./other.png");
  });

  test("uses attachments instead of the incompatible web flow", () => {
    expect(
      buildPullRequestCreateCommand({
        baseBranch: "main",
        title: "Show responsive layout",
        bodyFile: "/tmp/pr.md",
        attachments: ["./wide.png", "./narrow.png"],
      }),
    ).toEqual([
      "gh",
      "pr",
      "create",
      "--base",
      "main",
      "--title",
      "Show responsive layout",
      "--body-file",
      "/tmp/pr.md",
      "--attach",
      "./wide.png",
      "--attach",
      "./narrow.png",
    ]);

    expect(
      buildPullRequestCreateCommand({
        baseBranch: "main",
        title: "Update docs",
        bodyFile: "/tmp/pr.md",
        attachments: [],
      }),
    ).toContain("--web");
  });

  test("finds a branch PR after an ambiguous upload failure", async () => {
    expect(
      await findPullRequestUrl(async (args) => {
        expect(args).toEqual(["pr", "view", "--json", "url", "--jq", ".url"]);
        return {
          code: 0,
          stdout: "https://github.com/owner/repo/pull/123\n",
          stderr: "",
        };
      }),
    ).toBe("https://github.com/owner/repo/pull/123");

    expect(
      await findPullRequestUrl(async () => ({
        code: 1,
        stdout: "",
        stderr: "no pull requests found",
      })),
    ).toBeUndefined();
  });

  test("teaches the PR writer exact eligible paths", () => {
    const prompt = prInstruction(emptyRepoContext, undefined, undefined, [
      "./picker-wide.png",
      "./picker-narrow.png",
    ]);

    expect(prompt).toContain('"./picker-wide.png"');
    expect(prompt).toContain("ordinary markdown image syntax");
    expect(prompt).toContain("Put a video reference in its own paragraph");
    expect(prompt).toContain("product assets, icons, logos");

    expect(prInstruction(emptyRepoContext)).toContain(
      "Return an empty `attachments` array",
    );
  });
});
