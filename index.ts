import { generateText, Output } from "ai";
import { CAC } from "cac";
import chalk from "chalk";
import { countTokens } from "gpt-tokenizer";
import { simpleGit } from "simple-git";

import {
  responseSchema,
  systemInstruction,
  userInstruction,
} from "./constants";
import { formatAiError } from "./errors";
import { collectUntrackedFileContexts } from "./model-input";
import { version } from "./package.json" with { type: "json" };
import { handlePullRequest } from "./pr";
import { createPrompts } from "./prompts";
import { handlePush } from "./push";
import { defaultGenerationProviderOptions } from "./registry";
import { resolveProviderConfig } from "./resolution";
import {
  categorizeChangesCount,
  categorizeTokenCount,
  decapitalizeFirstLetter,
  getErrorMessage,
  pluralize,
  wrapText,
} from "./utils";

const cli = new CAC("shipit");

cli
  .command(
    "[...files]",
    "Send changes to AI to categorize and generate commit messages",
  )
  .option("-y,--yes", "Automatically accept all commits, same as --force")
  .option("-f,--force", "Automatically accept all commits, same as --yes")
  .option("-u,--unsafe", "Skip token count verification")
  .option("-p, --push", "Push the changes if any after processing all commits")
  .option("--pr", "Create a pull request (works with or without new commits)")
  .option(
    "-a,--appendix <text>",
    "Add extra context to append to the commit generation prompt",
  );

cli.help();
cli.version(version);

const { args, options } = cli.parse() as {
  args: string[];
  options: {
    // CLI options
    yes?: boolean;
    force?: boolean;
    unsafe?: boolean;
    push?: boolean;
    pr?: boolean;
    appendix?: string;

    // CAC options
    help?: boolean;
    version?: boolean;
  };
};

if (options.help || options.version) process.exit(0);

const shouldAutoAccept = !!(options.force || options.yes);

async function main() {
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

  const { files: _files, isClean, ...status } = await git.status(args);

  if (isClean()) {
    analysisSpinner.stop("Huh... squeaky clean. Nothing to see here.");
    outro("No changes? Time to get to work! 🙄");
    process.exit(0);
  }

  if (status.conflicted && status.conflicted.length > 0) {
    analysisSpinner.stop("⚠️ Merge conflicts detected");
    outro(
      `Holy sh*t! Fix your ${status.conflicted.length} ${pluralize(
        status.conflicted.length,
        "conflict",
      )} first: ${status.conflicted.join(", ")}`,
    );
    process.exit(1);
  }

  if (args.length > 0) {
    analysisSpinner.message("Sniffing out your specified paths...");

    const stagedOutsideSelectedPaths = status.staged.some(
      (stagedFile) =>
        !args.some(
          (selectedPath) =>
            stagedFile === selectedPath ||
            stagedFile.startsWith(`${selectedPath}/`),
        ),
    );

    if (stagedOutsideSelectedPaths) {
      analysisSpinner.stop("⚠️  Hold up! Mixed signals detected!");
      outro(`You've got staged files outside your selected paths.

Pick a lane:
- Unstage your files: \`git reset\`
- Commit the staged stuff first: \`git commit\`
- Or YOLO it without paths to handle everything`);
      process.exit(1);
    }
  }

  const diffArgs = args.length > 0 ? ["HEAD", "--", ...args] : ["HEAD"];
  const diffSummary = await git.diffSummary(diffArgs);
  const diff = await git.diff(diffArgs);
  const untrackedFileContexts = await collectUntrackedFileContexts({
    filePaths: status.not_added ?? [],
    selectedPaths: args,
  });

  analysisSpinner.stop(
    `${categorizeChangesCount(diffSummary.files.length)} You've touched ${chalk.bold(
      `${diffSummary.files.length} ${pluralize(
        diffSummary.files.length,
        "file",
      )}`,
    )}!`,
  );

  const prompt = userInstruction(
    status,
    diffSummary,
    diff,
    options.appendix,
    untrackedFileContexts,
  );

  const actualTokenCount = countTokens(prompt);
  const category = categorizeTokenCount(actualTokenCount);

  if (category.needsConfirmation && !options.unsafe) {
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
  commitSpinner.start("Crafting commit messages that don't suck...");
  let commitCount = 0;
  const createdCommitHashes: string[] = [];

  try {
    const { output } = await generateText({
      model: aiConfig.model,
      providerOptions: defaultGenerationProviderOptions,
      output: Output.array({
        element: responseSchema,
        name: "commit",
        description: "A focused commit group",
      }),
      system: systemInstruction,
      prompt,
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
          `${commit.files.length} ${pluralize(commit.files.length, "file")}`,
        )}: ${chalk.dim(wrapText(commit.files.join(", ")))}`,
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

        try {
          await git.add(commit.files);
        } catch (error) {
          log.error(
            `Dang, couldn't stage the files: ${getErrorMessage(error)}`,
          );
          process.exit(1);
        }

        const stagedDiffForCommit = await git.diff([
          "--cached",
          "--",
          ...commit.files,
        ]);
        if (!stagedDiffForCommit.trim()) {
          log.info(
            "No remaining staged changes for this commit group. Skipping it.",
          );
          continue;
        }

        try {
          const COMMIT_HASH_LENGTH = 7;
          const commitResult = await git.commit(message, commit.files);
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

  if (options.push) {
    await handlePush({
      git,
      log,
      spinner,
      confirm,
      createdCommitHashes,
    });
  }

  if ((commitCount > 0 && !shouldAutoAccept) || options.pr) {
    await handlePullRequest({
      git,
      log,
      spinner,
      confirm,
      options: Object.fromEntries(
        Object.entries(options).map(([key, value]) => [key, !!value]),
      ),
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

main().catch((error) => {
  console.error(formatAiError(error));
  process.exit(1);
});
