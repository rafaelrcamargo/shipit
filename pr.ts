import { randomUUID } from "node:crypto";
import { lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";

import { generateText, type LanguageModel, Output } from "ai";
import chalk from "chalk";
import type { SimpleGit } from "simple-git";

import { PR_REASONING } from "./ai-settings";
import { prInstruction, prSchema } from "./constants";
import {
  collectRepoContext,
  type ChangedFileContext,
  type CommandResult,
} from "./context";
import { formatAiError } from "./errors";
import {
  createAiSdkProgressCallbacks,
  createSpinnerProgressReporter,
} from "./progress";
import type { Prompts } from "./prompts";
import { isMissingTrackingBranchError } from "./push";
import { defaultGenerationProviderOptions } from "./registry";
import { findPrTemplate } from "./template";
import {
  formatDisplayPath,
  getBaseBranch,
  getErrorMessage,
  pluralize,
  wrapText,
} from "./utils";

type PrHandlerParams = {
  git: SimpleGit;
  log: Prompts["log"];
  spinner: Prompts["spinner"];
  confirm: Prompts["confirm"];
  options: {
    createPullRequest?: boolean;
    context?: string;
    ticketIds?: string[];
  };
  model: LanguageModel;
};

type PullRequestLog = (args: string[]) => Promise<{ total: number }>;

type GhRunner = (args: string[]) => Promise<CommandResult>;

const IMAGE_ATTACHMENT_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
]);
const VIDEO_ATTACHMENT_EXTENSIONS = new Set([".mp4", ".mov", ".webm"]);
const MAX_IMAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_ATTACHMENT_BYTES = 100 * 1024 * 1024;

const runGh: GhRunner = async (args) => {
  const proc = Bun.spawn(["gh", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { code, stdout, stderr };
};

export async function supportsPullRequestAttachments(
  runner: GhRunner = runGh,
): Promise<boolean> {
  try {
    const result = await runner(["pr", "create", "--help"]);
    return (
      result.code === 0 &&
      /(?:^|\s)--attach(?:\s|$)/m.test(`${result.stdout}\n${result.stderr}`)
    );
  } catch {
    return false;
  }
}

export async function getPullRequestAttachmentCandidates(
  repoRoot: string,
  changedFiles: ChangedFileContext[],
): Promise<string[]> {
  const rootPrefix = repoRoot.endsWith(sep) ? repoRoot : `${repoRoot}${sep}`;
  const candidates: string[] = [];

  for (const file of changedFiles) {
    if (/[#\r\n]/.test(file.path)) continue;

    const extension = extname(file.path).toLowerCase();
    const isImage = IMAGE_ATTACHMENT_EXTENSIONS.has(extension);
    const isVideo = VIDEO_ATTACHMENT_EXTENSIONS.has(extension);
    if (!isImage && !isVideo) continue;

    const absolutePath = resolve(repoRoot, file.path);
    if (!absolutePath.startsWith(rootPrefix)) continue;

    try {
      const info = await lstat(absolutePath);
      const maxBytes = isVideo
        ? MAX_VIDEO_ATTACHMENT_BYTES
        : MAX_IMAGE_ATTACHMENT_BYTES;
      if (!info.isFile() || info.size === 0 || info.size > maxBytes) continue;
    } catch {
      continue;
    }

    candidates.push(file.path.startsWith("./") ? file.path : `./${file.path}`);
  }

  return candidates;
}

export function resolvePullRequestAttachments(
  requested: string[],
  candidates: string[],
): string[] {
  const allowed = new Set(candidates);
  const selected = new Set<string>();

  for (const path of requested) {
    if (!allowed.has(path)) {
      throw new Error(`AI selected an unavailable PR attachment: ${path}`);
    }
    selected.add(path);
  }

  return [...selected];
}

export function buildPullRequestCreateCommand({
  baseBranch,
  title,
  bodyFile,
  attachments,
}: {
  baseBranch: string;
  title: string;
  bodyFile: string;
  attachments: string[];
}): string[] {
  const args = [
    "gh",
    "pr",
    "create",
    "--base",
    baseBranch,
    "--title",
    title,
    "--body-file",
    bodyFile,
  ];

  for (const path of attachments) {
    args.push("--attach", path);
  }
  if (attachments.length === 0) {
    args.push("--web");
  }

  return args;
}

export async function findPullRequestUrl(
  runner: GhRunner = runGh,
): Promise<string | undefined> {
  try {
    const result = await runner([
      "pr",
      "view",
      "--json",
      "url",
      "--jq",
      ".url",
    ]);
    const url = result.stdout.trim();
    return result.code === 0 && /^https:\/\/[^\s]+$/.test(url)
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

export type PullRequestPushState =
  | { status: "up-to-date" }
  | { status: "needs-push"; commitCount: number }
  | { status: "needs-first-push" };

export async function getPullRequestPushState(
  log: PullRequestLog,
  branch: string,
): Promise<PullRequestPushState> {
  try {
    const unpushedCommits = await log([`origin/${branch}..HEAD`, "--oneline"]);

    return unpushedCommits.total > 0
      ? { status: "needs-push", commitCount: unpushedCommits.total }
      : { status: "up-to-date" };
  } catch (error) {
    if (isMissingTrackingBranchError(error)) {
      return { status: "needs-first-push" };
    }

    throw error;
  }
}

export async function handlePullRequest({
  git,
  log,
  spinner,
  confirm,
  options,
  model,
}: PrHandlerParams): Promise<void> {
  try {
    const branch = await git.revparse(["--abbrev-ref", "HEAD"]);
    const { value: remoteUrl } = await git.getConfig("remote.origin.url");

    if (!remoteUrl) {
      log.info("No remote? No PR. Push your code somewhere first! 🤷");
      return;
    }

    const baseBranch = await getBaseBranch(git);

    if (!baseBranch) {
      log.info("No main or master branch? What kind of repo is this? 🤔");
      return;
    }

    if (branch === baseBranch) {
      return;
    }

    const branchCommits = await git.log([
      `origin/${baseBranch}..HEAD`,
      "--oneline",
    ]);

    if (branchCommits.total === 0) {
      log.info(`No commits ahead of ${baseBranch}? Nothing to PR here! 🤷`);
      return;
    }

    const shouldCreatePR =
      options.createPullRequest ||
      (await confirm({
        message: `Want me to cook up a PR for ${
          branchCommits.total
        } ${pluralize(branchCommits.total, "commit")}?`,
        initialValue: true,
      }));

    if (shouldCreatePR !== true) {
      return;
    }

    try {
      const pushState = await getPullRequestPushState(
        (logArgs) => git.log(logArgs),
        branch,
      );

      if (pushState.status === "needs-push") {
        const shouldPush = await confirm({
          message: `Push ${pushState.commitCount} unpushed ${pluralize(
            pushState.commitCount,
            "commit",
          )} to origin/${branch}?`,
          initialValue: true,
        });

        if (shouldPush !== true) {
          return;
        }

        const pushSpinner = spinner();
        pushSpinner.start(
          `Pushing ${pushState.commitCount} ${pluralize(
            pushState.commitCount,
            "commit",
          )} to origin/${branch}...`,
        );

        await git.push("origin", branch);
        pushSpinner.stop("Pushed! Your code is now live and ready to PR");
      } else if (pushState.status === "needs-first-push") {
        const shouldPush = await confirm({
          message: `This branch has not been pushed to origin/${branch}. Push it now?`,
          initialValue: true,
        });

        if (shouldPush !== true) {
          return;
        }

        const pushSpinner = spinner();
        pushSpinner.start(`Pushing new branch to origin/${branch}...`);
        await git.push("origin", branch, ["--set-upstream"]);
        pushSpinner.stop(`Pushed new branch to origin/${branch}`);
      } else {
        log.info("Branch is already up to date with remote! 👍");
      }
    } catch (error) {
      log.error(
        `Push failed! You'll need to handle that manually first: ${getErrorMessage(
          error,
        )}`,
      );
      return;
    }

    const prSpinner = spinner();
    prSpinner.start("Collecting PR context...");
    const progress = createSpinnerProgressReporter({
      spinner: prSpinner,
      log,
    });

    prSpinner.message("Reading PR template...");
    const template = await findPrTemplate(git);
    if (template) {
      log.info(
        `Found PR template at ${chalk.cyan(
          formatDisplayPath(template.source),
        )} - following repository guidelines! 📝`,
      );
    }

    prSpinner.message("Collecting GitHub and Linear context...");
    const repoContext = await collectRepoContext(git, {
      baseBranch,
      includeGithub: true,
      ticketIds: options.ticketIds ?? [],
    });
    const repoRoot = (await git.revparse(["--show-toplevel"])).trim();
    const attachmentCandidates = await getPullRequestAttachmentCandidates(
      repoRoot,
      repoContext.changedFiles,
    );
    const canAttach =
      attachmentCandidates.length > 0 &&
      (await supportsPullRequestAttachments());
    const availableAttachments = canAttach ? attachmentCandidates : [];
    if (attachmentCandidates.length > 0 && !canAttach) {
      log.info(
        "This GitHub CLI build doesn't support PR attachments; generating a text-only PR.",
      );
    }
    prSpinner.message(
      `Writing PR with ${repoContext.commits.length} commit(s), ${repoContext.changedFiles.length} changed file(s), ${template ? "template found" : "no template"}...`,
    );
    const hasUnavailableLinearContext =
      repoContext.linear.omittedReason &&
      ![
        "LINEAR_API_KEY is not configured",
        "no Linear branch or issue identifiers found",
        "no matching Linear issues found",
      ].includes(repoContext.linear.omittedReason);
    const unavailableContextCount =
      repoContext.omittedReasons.length +
      (repoContext.github.omittedReason ? 1 : 0) +
      (hasUnavailableLinearContext ? 1 : 0);
    if (unavailableContextCount > 0) {
      log.info(
        `Context budget: ${unavailableContextCount} optional context ${pluralize(
          unavailableContextCount,
          "item",
        )} unavailable or compressed.`,
      );
    }

    let prInfo;
    try {
      const result = await generateText({
        model,
        providerOptions: defaultGenerationProviderOptions,
        output: Output.object({ schema: prSchema }),
        prompt: prInstruction(
          repoContext,
          template || undefined,
          options.context,
          availableAttachments,
        ),
        reasoning: PR_REASONING,
        telemetry: {
          isEnabled: false,
        },
        ...createAiSdkProgressCallbacks(progress, {
          phase: "pr",
          label: "Writing PR description",
          durable: true,
        }),
      });
      progress.warning(
        {
          phase: "pr",
          label: "Writing PR description",
        },
        result.warnings?.length ?? 0,
      );
      prInfo = result.output;
    } catch (error) {
      prSpinner.stop("Couldn't generate PR content.");
      log.error(formatAiError(error));
      return;
    }

    let attachments: string[];
    try {
      attachments = resolvePullRequestAttachments(
        prInfo.attachments,
        availableAttachments,
      );
    } catch (error) {
      prSpinner.stop("Couldn't validate PR attachments.");
      log.error(getErrorMessage(error));
      return;
    }

    prSpinner.stop("Nice! Got your PR ready to rock...");

    log.message("", { symbol: chalk.gray("│") });
    log.message(chalk.bold("PR Title:"), { symbol: chalk.gray("│") });
    log.message(prInfo.title, { symbol: chalk.gray("│") });
    log.message("", { symbol: chalk.gray("│") });
    log.message(chalk.bold("PR Body:"), { symbol: chalk.gray("│") });
    log.message(chalk.dim(wrapText(prInfo.body)), {
      symbol: chalk.gray("│"),
    });
    if (attachments.length > 0) {
      log.message("", { symbol: chalk.gray("│") });
      log.message(chalk.bold("PR Attachments:"), { symbol: chalk.gray("│") });
      for (const path of attachments) {
        log.message(path, { symbol: chalk.gray("│") });
      }
    }
    log.message("", { symbol: chalk.gray("│") });

    const confirmPR = await confirm({
      message: "Ship it to GitHub?",
      initialValue: true,
    });

    if (confirmPR !== true) {
      return;
    }

    const tempFile = join(
      tmpdir(),
      `shipit-pr-body-${Date.now()}-${randomUUID()}.md`,
    );

    try {
      await Bun.write(tempFile, prInfo.body);

      const args = buildPullRequestCreateCommand({
        baseBranch,
        title: prInfo.title,
        bodyFile: tempFile,
        attachments,
      });

      const proc = Bun.spawn(args, {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [output, errors, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (exitCode !== 0) {
        log.error(`GitHub CLI error: ${errors || output}`);
        if (attachments.length > 0) {
          const prUrl = await findPullRequestUrl();
          if (prUrl) {
            log.info(
              `A PR is present for this branch: ${chalk.cyan(prUrl)}. Inspect its body before retrying attachments.`,
            );
          } else {
            log.info(
              "An attachment upload may have partially succeeded. Inspect the branch's PR state before retrying.",
            );
          }
        }
        return;
      }

      if (output.includes("https://") || errors.includes("Opening")) {
        log.success(
          attachments.length > 0
            ? "PR created with review media! Time to ship it 🚀"
            : "PR opened in your browser! Time to ship it 🚀",
        );

        const urlMatch = (output + errors).match(/https:\/\/[^\s]+/);
        if (urlMatch) {
          log.info(`${chalk.cyan(urlMatch[0])}`);
        }
      }
    } catch (error) {
      log.error(`Dang! Couldn't create the PR: ${getErrorMessage(error)}`);
      log.info("Manual backup plan:");
      log.info(
        `${chalk.cyan(
          remoteUrl.replace(".git", ""),
        )}/compare/${baseBranch}...${branch}`,
      );
    } finally {
      await rm(tempFile, { force: true }).catch(() => undefined);
    }
  } catch (error) {
    log.error(`Well sh*t, PR creation went sideways: ${formatAiError(error)}`);
  }
}
