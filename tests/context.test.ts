import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { simpleGit } from "simple-git";

import { prInstruction } from "../constants";
import {
  collectRepoContext,
  type CommandRunner,
  serializeRepoContextForPrompt,
} from "../context";

async function createBranchRepo(branchName = "feature/issue-123-context") {
  const root = await mkdtemp(join(tmpdir(), "shipit-context-"));
  const git = simpleGit(root);

  await git.init();
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test User");
  await git.raw(["checkout", "-b", "main"]);
  await writeFile(join(root, "base.txt"), "base\n");
  await git.add("base.txt");
  await git.commit("base");
  await git.raw(["checkout", "-b", branchName]);
  await writeFile(join(root, "base.txt"), "base\nchanged\n");
  await git.add("base.txt");
  await git.commit("fix: update base\n\nAdds reviewer context.");

  return { root, git };
}

describe("collectRepoContext", () => {
  test("includes commit list, diff stats, and changed files", async () => {
    const { root, git } = await createBranchRepo();

    try {
      const context = await collectRepoContext(git, {
        baseBranch: "main",
        includeGithub: false,
        includeLinear: false,
      });

      expect(context.branch).toBe("feature/issue-123-context");
      expect(context.baseRef).toBe("main");
      expect(context.commits).toContainEqual(
        expect.objectContaining({
          message: "fix: update base",
          body: "Adds reviewer context.",
        }),
      );
      expect(context.diff.stat).toContain("base.txt");
      expect(context.diff.numstat).toContain("base.txt");
      expect(context.diff.nameStatus).toContain("base.txt");
      expect(context.changedFiles).toContainEqual(
        expect.objectContaining({
          path: "base.txt",
          status: "M",
          insertions: 1,
          deletions: 0,
        }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not fail when gh is unavailable", async () => {
    const { root, git } = await createBranchRepo();
    const runner: CommandRunner = async () => {
      throw new Error("gh unavailable");
    };

    try {
      const context = await collectRepoContext(git, {
        baseBranch: "main",
        commandRunner: runner,
        includeLinear: false,
      });

      expect(context.github).toMatchObject({
        isAvailable: false,
        omittedReason: "gh unavailable",
      });
      expect(context.commits).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("skips gh context when SHIPIT_DISABLE_GH is enabled", async () => {
    const { root, git } = await createBranchRepo();
    const runner: CommandRunner = async () => {
      throw new Error("gh should not be called");
    };

    try {
      const context = await collectRepoContext(git, {
        baseBranch: "main",
        commandRunner: runner,
        includeLinear: false,
        env: {
          SHIPIT_DISABLE_GH: "1",
        },
      });

      expect(context.github).toMatchObject({
        isAvailable: false,
        omittedReason: "SHIPIT_DISABLE_GH=1",
        linkedIssues: [],
      });
      expect(context.commits).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("includes existing PR and linked issue context when gh succeeds", async () => {
    const { root, git } = await createBranchRepo();
    const runner: CommandRunner = async (_command, args) => {
      const joined = args.join(" ");
      if (joined === "auth status") {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (joined.startsWith("pr view")) {
        return {
          code: 0,
          stdout: JSON.stringify({
            number: 7,
            title: "Existing PR",
            body: "Existing body",
            url: "https://github.com/acme/repo/pull/7",
          }),
          stderr: "",
        };
      }
      if (joined.startsWith("repo view")) {
        return {
          code: 0,
          stdout: JSON.stringify({
            nameWithOwner: "acme/repo",
            description: "A test repo",
            url: "https://github.com/acme/repo",
          }),
          stderr: "",
        };
      }
      if (joined.startsWith("issue view 123")) {
        return {
          code: 0,
          stdout: JSON.stringify({
            number: 123,
            title: "Linked issue",
            state: "OPEN",
            url: "https://github.com/acme/repo/issues/123",
          }),
          stderr: "",
        };
      }
      return { code: 1, stdout: "", stderr: "not found" };
    };

    try {
      const context = await collectRepoContext(git, {
        baseBranch: "main",
        commandRunner: runner,
        includeLinear: false,
      });

      expect(context.github.existingPr).toMatchObject({
        number: 7,
        title: "Existing PR",
      });
      expect(context.github.repository).toMatchObject({
        nameWithOwner: "acme/repo",
      });
      expect(context.github.linkedIssues).toContainEqual(
        expect.objectContaining({
          number: 123,
          title: "Linked issue",
        }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("PR prompt includes repo context and template content", async () => {
    const { root, git } = await createBranchRepo();

    try {
      const context = await collectRepoContext(git, {
        baseBranch: "main",
        includeGithub: false,
        includeLinear: false,
      });
      const prompt = prInstruction(
        context,
        {
          source: ".github/PULL_REQUEST_TEMPLATE.md",
          content: "## Testing\n\n- [ ] Added tests",
        },
        "Release safely",
      );

      expect(prompt).toContain("Repository Context");
      expect(prompt).toContain("base.txt");
      expect(prompt).toContain("## Testing");
      expect(prompt).toContain("Release safely");
      expect(serializeRepoContextForPrompt(context).changedFiles).toHaveLength(
        1,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not fetch or serialize Linear context without LINEAR_API_KEY", async () => {
    const { root, git } = await createBranchRepo("feature/ENG-123-context");
    let called = false;

    try {
      const context = await collectRepoContext(git, {
        baseBranch: "main",
        includeGithub: false,
        linearApiKey: "",
        ticketIds: ["ENG-123"],
        linearIssueFetcher: async () => {
          called = true;
          return [];
        },
      });

      expect(called).toBe(false);
      expect(context.linear).toMatchObject({
        isAvailable: false,
        omittedReason: "LINEAR_API_KEY is not configured",
        issues: [],
      });
      expect(serializeRepoContextForPrompt(context)).toHaveProperty(
        "ticketIds",
        ["ENG-123"],
      );
      expect(serializeRepoContextForPrompt(context)).not.toHaveProperty(
        "linear",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("includes Linear issue context when an API key is configured", async () => {
    const { root, git } = await createBranchRepo("feature/ENG-123-context");

    try {
      const context = await collectRepoContext(git, {
        baseBranch: "main",
        includeGithub: false,
        linearApiKey: "linear-key",
        linearIssueFetcher: async (apiKey, identifiers, branch) => {
          expect(apiKey).toBe("linear-key");
          expect(identifiers).toEqual(["ENG-123"]);
          expect(branch).toBe("feature/ENG-123-context");
          return [
            {
              identifier: "ENG-123",
              title: "Add reviewer context",
              description: "Ticket context for the PR.",
              state: "In Progress",
              priority: 2,
              priorityLabel: "High",
              assignee: "Ada Lovelace",
              labels: ["commit"],
              url: "https://linear.app/acme/issue/ENG-123",
            },
          ];
        },
      });

      expect(context.linear.issues).toContainEqual(
        expect.objectContaining({
          identifier: "ENG-123",
          title: "Add reviewer context",
        }),
      );
      expect(JSON.stringify(serializeRepoContextForPrompt(context))).toContain(
        "Add reviewer context",
      );
      expect(prInstruction(context)).toContain("Add reviewer context");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses normalized explicit ticket IDs to fetch Linear context", async () => {
    const { root, git } = await createBranchRepo();

    try {
      const context = await collectRepoContext(git, {
        baseBranch: "main",
        includeGithub: false,
        linearApiKey: "linear-key",
        ticketIds: ["ENG-456"],
        linearIssueFetcher: async (_apiKey, identifiers) => {
          expect(identifiers).toEqual(["ENG-456"]);
          return [
            {
              identifier: "ENG-456",
              title: "Support explicit ticket IDs",
              labels: [],
            },
          ];
        },
      });

      expect(context.linear.issues[0]?.identifier).toBe("ENG-456");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("records Linear errors as unavailable optional context", async () => {
    const { root, git } = await createBranchRepo("feature/ENG-789-context");

    try {
      const context = await collectRepoContext(git, {
        baseBranch: "main",
        includeGithub: false,
        linearApiKey: "bad-key",
        linearIssueFetcher: async () => {
          throw new Error("Linear unavailable");
        },
      });

      expect(context.linear).toMatchObject({
        isAvailable: false,
        omittedReason: "Linear unavailable",
        issues: [],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
