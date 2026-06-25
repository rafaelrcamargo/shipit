import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateText, type LanguageModel, Output } from "ai";
import chalk from "chalk";
import type { SimpleGit } from "simple-git";

import { PR_REASONING } from "./ai-settings";
import { prInstruction, prSchema } from "./constants";
import { collectRepoContext } from "./context";
import { formatAiError } from "./errors";
import {
  createAiSdkProgressCallbacks,
  createSpinnerProgressReporter,
} from "./progress";
import type { Prompts } from "./prompts";
import { isMissingTrackingBranchError } from "./push";
import { defaultGenerationProviderOptions } from "./registry";
import { findPrTemplate } from "./template";
import { getBaseBranch, getErrorMessage, pluralize, wrapText } from "./utils";

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
        `Found PR template at ${chalk.cyan(template.source)} - following repository guidelines! 📝`,
      );
    }

    prSpinner.message("Collecting GitHub and Linear context...");
    const repoContext = await collectRepoContext(git, {
      baseBranch,
      includeGithub: true,
      ticketIds: options.ticketIds ?? [],
    });
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

    prSpinner.stop("Nice! Got your PR ready to rock...");

    log.message("", { symbol: chalk.gray("│") });
    log.message(chalk.bold("PR Title:"), { symbol: chalk.gray("│") });
    log.message(prInfo.title, { symbol: chalk.gray("│") });
    log.message("", { symbol: chalk.gray("│") });
    log.message(chalk.bold("PR Body:"), { symbol: chalk.gray("│") });
    log.message(chalk.dim(wrapText(prInfo.body)), {
      symbol: chalk.gray("│"),
    });
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

      const proc = Bun.spawn(
        [
          "gh",
          "pr",
          "create",
          "--base",
          baseBranch,
          "--title",
          prInfo.title,
          "--body-file",
          tempFile,
          "--web",
        ],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      const output = await new Response(proc.stdout).text();
      const errors = await new Response(proc.stderr).text();

      if (errors && !errors.includes("Opening")) {
        log.error("GitHub CLI error: " + errors);
      }

      if (
        output.includes("Opening") ||
        output.includes("https://") ||
        errors.includes("Opening")
      ) {
        log.success("PR opened in your browser! Time to ship it 🚀");

        const urlMatch = (output + errors).match(/https:\/\/[^\s]+/);
        if (urlMatch) {
          log.info(`${chalk.cyan(urlMatch[0])}`);
        }
      }
    } catch (error) {
      log.error(`Dang! Couldn't open PR in browser: ${getErrorMessage(error)}`);
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
