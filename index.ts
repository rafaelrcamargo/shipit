import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamObject } from "ai";
import { CAC } from "cac";
import chalk from "chalk";
import { countTokens } from "gpt-tokenizer";
import { simpleGit } from "simple-git";
import {
  responseZodSchema,
  systemInstruction,
  userInstruction,
} from "./constants.ts";
import { version } from "./package.json" with { type: "json" };
import { handlePullRequest } from "./pr.ts";
import { createPrompts } from "./prompts.ts";
import { handlePush } from "./push.ts";
import {
  categorizeChangesCount,
  categorizeTokenCount,
  decapitalizeFirstLetter,
  getErrorMessage,
  pluralize,
  wrapText,
} from "./utils.ts";

const cli = new CAC("shipit");

cli
  .command(
    "[...files]",
    "Send changes to AI to categorize and generate commit messages",
  )
  .option("-s,--silent", "Only log fatal errors to the console")
  .option("-y,--yes", "Automatically accept all commits, same as --force")
  .option("-f,--force", "Automatically accept all commits, same as --yes")
  .option("-u,--unsafe", "Skip token count verification")
  .option("-p, --push", "Push the changes if any after processing all commits")
  .option("--pr", "Automatically create a pull request");

cli.help();
cli.version(version);

const { args, options } = cli.parse() as {
  args: string[];
  options: { [key: string]: boolean };
};

if (options["help"] || options["version"]) process.exit(0);

async function main() {
  const { log, note, outro, spinner, confirm } = createPrompts({
    silent: options["silent"],
    force: options["force"] || options["yes"],
  });

  if (!options["silent"] && !options["force"] && !options["yes"]) {
    note(
      chalk.italic("Because writing 'fix stuff' gets old real quick..."),
      chalk.bold("🧹 Git Your Sh*t Together"),
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

    if (status.staged && status.staged.length > 0) {
      analysisSpinner.stop("⚠️  Hold up! Mixed signals detected!");
      outro(`You've got staged files AND specified paths? That's not gonna work.

Pick a lane:
- Unstage your sh*t: \`git reset\`
- Commit the staged stuff first: \`git commit\`
- Or YOLO it without paths to handle everything`);
      process.exit(1);
    }
  }

  const diffSummary = await git.diffSummary(args);
  const diff = await git.diff(args);

  analysisSpinner.stop(
    `${categorizeChangesCount(diffSummary.files.length)} You've touched ${chalk.bold(
      `${diffSummary.files.length} ${pluralize(
        diffSummary.files.length,
        "file",
      )}`,
    )}!`,
  );

  const prompt = userInstruction(status, diffSummary, diff);

  const actualTokenCount = countTokens(prompt);
  const category = categorizeTokenCount(actualTokenCount);

  if (category.needsConfirmation && !options["unsafe"]) {
    const shouldContinue = await confirm({
      message: `${chalk.bold(
        `${category.emoji ? `${category.emoji} ` : ""}Whoa there!`,
      )} ${category.description}. ${chalk.italic.dim(
        "You sure you want to burn those tokens?",
      )}`,
      initialValue: false,
    });

    if (!shouldContinue) {
      outro("Smart move. Maybe split that monster diff next time? 🤔");
      process.exit(0);
    }
  }

  const apiKey = process.env["GOOGLE_GENERATIVE_AI_API_KEY"];

  if (!apiKey) {
    log.error("GOOGLE_GENERATIVE_AI_API_KEY is not set");
    process.exit(1);
  }

  const google = createGoogleGenerativeAI({ apiKey });

  const { elementStream } = streamObject({
    model: google("gemini-2.5-flash"),
    providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
    output: "array",
    schema: responseZodSchema,
    system: systemInstruction,
    prompt: userInstruction(status, diffSummary, diff),
  });

  const commitSpinner = spinner();
  commitSpinner.start("Crafting commit messages that don't suck...");

  let commitCount = 0;
  for await (const commit of elementStream) {
    log.message("", { symbol: chalk.gray("│") });
    if (commitCount === 0) {
      commitSpinner.stop("Hot damn! Here come the goods...");
    }

    const description = decapitalizeFirstLetter(commit.description);
    let prefix = `${commit.type}${
      commit.scope?.length ? `(${commit.scope})` : ""
    }${commit.breaking ? "!" : ""}`;

    // The AI might redundantly include the prefix in the description, so we remove it here.
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

    if (shouldCommit) {
      let message = commitMessage;
      if (commit.body?.length) message += `\n\n${commit.body}`;
      if (commit.footers?.length) message += `\n\n${commit.footers.join("\n")}`;

      try {
        await git.add(commit.files);
      } catch (error) {
        log.error(
          `Well sh*t, couldn't stage the files: ${getErrorMessage(error)}`,
        );
        process.exit(1);
      }

      try {
        const COMMIT_HASH_LENGTH = 7;
        const commitResult = await git.commit(message, commit.files);
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

  if (commitCount > 0 && !options["force"] && !options["yes"]) {
    await handlePullRequest({ git, log, spinner, confirm, options });
  }

  if (options["push"]) {
    await handlePush({ git, log, spinner });
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

main();
