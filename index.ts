import { CAC } from "cac";
import chalk from "chalk";
import { countTokens } from "gpt-tokenizer";
import { simpleGit } from "simple-git";

import {
  collectChangeSet,
  getChangeLabels,
  getChangeSetDrift,
  getPathspecsForChangeIds,
} from "./changes";
import {
  normalizeCliOptions,
  type NormalizedCliOptions,
  type RawCliOptions,
} from "./cli-options";
import { createCommitPlanPrompt, generateCommitPlan } from "./commit-plan";
import { collectRepoContext } from "./context";
import { formatAiError } from "./errors";
import { version } from "./package.json" with { type: "json" };
import { handlePullRequest } from "./pr";
import { createSpinnerProgressReporter } from "./progress";
import { createPrompts } from "./prompts";
import { handlePush } from "./push";
import { resolveProviderConfig } from "./resolution";
import { printStatus } from "./status";
import {
  categorizeChangesCount,
  categorizeTokenCount,
  decapitalizeFirstLetter,
  formatDisplayPath,
  formatDisplayPathChange,
  getErrorMessage,
  pluralize,
  wrapText,
} from "./utils";

const cli = new CAC("shipit");
const rawArgv = process.argv.slice(2);
const isStatusCommand = rawArgv[0] === "status";

cli.command("status", "Show resolved provider, API key, and context status");

cli
  .command("[...files]", "Plan commits from your Git changes")
  .option("-y, --yes", "Automatically accept generated commit prompts")
  .option("--skip-token-check", "Skip token count confirmation")
  .option("-p, --push", "Push the changes if any after processing all commits")
  .option(
    "--pr, --pull-request",
    "Create a PR; without path args, works with or without new commits",
  )
  .option("-t, --ticket <id>", "Add a ticket ID, repeatable")
  .option("--context <text>", "Add extra context to the commit and PR prompts");

cli.help();
cli.version(version);

const { args, options } = cli.parse() as {
  args: string[];
  options: RawCliOptions & {
    help?: boolean;
    version?: boolean;
  };
};

if (options.help || options.version) process.exit(0);

if (isStatusCommand) {
  printStatus()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(getErrorMessage(error));
      process.exit(1);
    });
} else {
  let cliOptions: NormalizedCliOptions;
  try {
    cliOptions = normalizeCliOptions(options, rawArgv);
  } catch (error) {
    console.error(getErrorMessage(error));
    process.exit(1);
  }

  const shouldAutoAccept = cliOptions.yes;

  main(cliOptions, shouldAutoAccept).catch((error) => {
    console.error(formatAiError(error));
    process.exit(1);
  });
}

async function main(
  cliOptions: NormalizedCliOptions,
  shouldAutoAccept: boolean,
) {
  const { log, note, outro, spinner, confirm } = createPrompts({
    force: shouldAutoAccept,
  });

  let aiConfig: ReturnType<typeof resolveProviderConfig>;
  try {
    aiConfig = resolveProviderConfig();
  } catch (error) {
    log.error(getErrorMessage(error));
    process.exit(1);
  }

  if (!shouldAutoAccept) {
    note(
      chalk.italic("Because writing 'fix stuff' gets old real quick..."),
      chalk.bold("🧹 Git Your Sh*t Together"),
    );
    log.info(
      `Detected ${chalk.bold(aiConfig.provider)} API Key. Using ${chalk.bold(aiConfig.name)} for AI assistance.`,
    );
  }

  const analysisSpinner = spinner();
  analysisSpinner.start("Let's see what mess you've made this time...");

  const git = simpleGit(process.cwd());

  if (!(await git.checkIsRepo())) {
    analysisSpinner.stop("❌ Well, this is awkward...");
    outro(
      "Not a git repo? What are you trying to commit here? Run `git init` first! 🤦",
    );
    process.exit(1);
  }

  const changeSet = await collectChangeSet(git, args);

  if (changeSet.allChanges.length === 0 && changeSet.conflicts.length === 0) {
    if (cliOptions.createPullRequest) {
      analysisSpinner.stop(
        "Working tree is clean. Checking branch PR state...",
      );
      await handlePullRequest({
        git,
        log,
        spinner,
        confirm,
        options: {
          createPullRequest: cliOptions.createPullRequest,
          context: cliOptions.context,
          ticketIds: cliOptions.ticketIds,
        },
        model: aiConfig.model,
      });
      outro("No local changes to commit.");
      return;
    }

    analysisSpinner.stop("Huh... squeaky clean. Nothing to see here.");
    outro("No changes? Time to get to work! 🙄");
    process.exit(0);
  }

  if (changeSet.conflicts.length > 0) {
    analysisSpinner.stop("⚠️ Merge conflicts detected");
    outro(
      `Holy sh*t! Fix your ${changeSet.conflicts.length} ${pluralize(
        changeSet.conflicts.length,
        "conflict",
      )} first: ${changeSet.conflicts
        .map((conflict) => formatDisplayPath(conflict.path))
        .join(", ")}`,
    );
    process.exit(1);
  }

  if (args.length > 0) {
    analysisSpinner.message("Sniffing out your specified paths...");

    if (changeSet.stagedOutsideSelectedChanges.length > 0) {
      analysisSpinner.stop("⚠️  Hold up! Mixed signals detected!");
      outro(`You've got staged changes outside your selected paths: ${changeSet.stagedOutsideSelectedChanges
        .map(formatDisplayPathChange)
        .join(", ")}

Pick a lane:
- Unstage your files: \`git reset\`
- Commit the staged stuff first: \`git commit\`
- Or YOLO it without paths to handle everything`);
      process.exit(1);
    }
  }

  if (changeSet.changes.length === 0) {
    analysisSpinner.stop("No changes found in your selected paths.");
    outro("No selected changes? Try a different path or run without paths.");
    process.exit(0);
  }

  analysisSpinner.stop(
    `${categorizeChangesCount(changeSet.changes.length)} You've touched ${chalk.bold(
      `${changeSet.changes.length} ${pluralize(
        changeSet.changes.length,
        "change",
      )}`,
    )}!`,
  );

  const repoContext = await collectRepoContext(git, {
    changeSet,
    selectedPaths: args,
    includeGithub: true,
    ticketIds: cliOptions.ticketIds,
  });

  if (
    repoContext.ticketIds.length > 0 &&
    repoContext.linear.omittedReason === "LINEAR_API_KEY is not configured"
  ) {
    log.info(
      "Ticket IDs will be included without Linear details. Set LINEAR_API_KEY to fetch ticket context.",
    );
  }

  const actualTokenCount = countTokens(
    createCommitPlanPrompt(changeSet, repoContext, cliOptions.context),
  );
  const category = categorizeTokenCount(actualTokenCount);

  if (category.needsConfirmation && !cliOptions.skipTokenCheck) {
    const shouldContinue = await confirm({
      message: `${chalk.bold(
        `${category.emoji ? `${category.emoji} ` : ""}Whoa there!`,
      )} ${category.description}. ${chalk.italic.dim(
        "You sure you want to burn those tokens?",
      )}`,
      initialValue: false,
    });

    if (shouldContinue !== true) {
      outro("Smart move. Maybe split that monster diff next time? 🤔");
      process.exit(0);
    }
  }

  const commitSpinner = spinner();
  commitSpinner.start("Planning commits with AI...");
  const commitProgress = createSpinnerProgressReporter({
    spinner: commitSpinner,
    log,
  });
  let commitCount = 0;
  const createdCommitHashes: string[] = [];

  try {
    const { commits: output } = await generateCommitPlan({
      model: aiConfig.model,
      providerId: aiConfig.id,
      modelId: aiConfig.modelId,
      changeSet,
      repoContext,
      context: cliOptions.context,
      progress: commitProgress,
    });

    commitSpinner.stop("Here come the goods...");
    if (output.length === 0) {
      log.info("AI didn't propose any commits for these changes.");
    }

    for (const commit of output) {
      const description = decapitalizeFirstLetter(commit.description);
      let prefix = `${commit.type}${
        commit.scope?.length ? `(${commit.scope})` : ""
      }${commit.breaking ? "!" : ""}`;

      // The AI may redundantly include the prefix in the description, so we remove it.
      if (description.startsWith(prefix)) {
        prefix = "";
      }

      const displayMessage = `${
        prefix ? `${chalk.bold(`${prefix}: `)}` : ""
      }${description}`;
      const commitMessage = `${prefix ? `${prefix}: ` : ""}${description}`;

      log.message(chalk.gray("━━━"), { symbol: chalk.gray("│") });
      log.message(displayMessage, { symbol: chalk.gray("│") });

      if (commit.body?.length) {
        log.message(chalk.dim(wrapText(commit.body)), {
          symbol: chalk.gray("│"),
        });
      }

      if (commit.footers?.length) {
        log.message(
          `${commit.footers.map((footer) => wrapText(footer)).join("\n")}`,
          { symbol: chalk.gray("│") },
        );
      }

      log.message(chalk.gray("━━━"), { symbol: chalk.gray("│") });
      log.message(
        `Applies to these ${chalk.bold(
          `${commit.changeIds.length} ${pluralize(
            commit.changeIds.length,
            "change",
          )}`,
        )}: ${chalk.dim(
          wrapText(
            getChangeLabels(changeSet, commit.changeIds, {
              formatPath: formatDisplayPath,
            }).join(", "),
          ),
        )}`,
        { symbol: chalk.gray("│") },
      );

      const shouldCommit = await confirm({
        message: `Ship it?`,
      });

      if (shouldCommit === true) {
        let message = commitMessage;
        if (commit.body?.length) message += `\n\n${commit.body}`;
        if (commit.footers?.length)
          message += `\n\n${commit.footers.join("\n")}`;

        const currentChangeSet = await collectChangeSet(git, args);
        const drift = getChangeSetDrift(
          changeSet,
          currentChangeSet,
          commit.changeIds,
          { formatPath: formatDisplayPath },
        );
        if (drift.length > 0) {
          log.error(
            `Selected changes changed since AI analysis:\n${drift.join("\n")}`,
          );
          process.exit(1);
        }

        const stagePathspecs = getPathspecsForChangeIds(
          changeSet,
          commit.changeIds,
          "stagePathspecs",
        );
        const commitPathspecs = getPathspecsForChangeIds(
          changeSet,
          commit.changeIds,
          "commitPathspecs",
        );

        try {
          await git.raw(["add", "-A", "--", ...stagePathspecs]);
        } catch (error) {
          log.error(
            `Dang, couldn't stage the files: ${getErrorMessage(error)}`,
          );
          process.exit(1);
        }

        const stagedDiffForCommit = await git.diff([
          "--cached",
          "--",
          ...commitPathspecs,
        ]);
        if (!stagedDiffForCommit.trim()) {
          log.info(
            "No remaining staged changes for this commit group. Skipping it.",
          );
          continue;
        }

        try {
          const COMMIT_HASH_LENGTH = 7;
          const commitResult = await git.commit(message, commitPathspecs);
          createdCommitHashes.push(commitResult.commit);
          log.success(
            `Committed to ${commitResult.branch}: ${chalk.bold(
              commitResult.commit.slice(0, COMMIT_HASH_LENGTH),
            )} ${chalk.dim(
              `(${commitResult.summary.changes} changes, ${chalk.green(
                "+" + commitResult.summary.insertions,
              )}, ${chalk.red("-" + commitResult.summary.deletions)})`,
            )}`,
          );
        } catch (error) {
          log.error(`Commit failed: ${getErrorMessage(error)}`);
          process.exit(1);
        }

        commitCount++;
      } else {
        log.info("Your loss, champ. Next!");
      }
    }
  } catch (error) {
    commitSpinner.stop("AI generation failed.");
    log.error(formatAiError(error));
    process.exit(1);
  }

  if (cliOptions.push) {
    await handlePush({
      git,
      log,
      spinner,
      confirm,
      createdCommitHashes,
    });
  }

  if ((commitCount > 0 && !shouldAutoAccept) || cliOptions.createPullRequest) {
    await handlePullRequest({
      git,
      log,
      spinner,
      confirm,
      options: {
        createPullRequest: cliOptions.createPullRequest,
        context: cliOptions.context,
        ticketIds: cliOptions.ticketIds,
      },
      model: aiConfig.model,
    });
  }

  if (commitCount > 0) {
    outro(
      `Boom! ${commitCount} ${pluralize(
        commitCount,
        "commit",
      )} that actually makes sense. You're welcome!`,
    );
  } else {
    outro("No commits? Time to get to work! 🙄");
  }
}
