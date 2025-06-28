// --force --unsafe (-fu)

import { google } from "@ai-sdk/google";
import { confirm, log, note, outro, spinner } from "@clack/prompts";
import { streamObject } from "ai";
import chalk from "chalk";
import { countTokens } from "gpt-tokenizer";
import { simpleGit } from "simple-git";
import {
  responseZodSchema,
  systemInstruction,
  userInstruction,
} from "./constants.ts";
import {
  categorizeChangesCount,
  categorizeTokenCount,
  decapitalizeFirstLetter,
  time,
  wrapText,
} from "./utils.ts";

note(
  chalk.italic("Because writing 'fix stuff' gets old real quick..."),
  chalk.bold("🧹 Git Your Sh*t Together"),
);

log.info("Let's see what mess you've made this time...");

const analysisSpinner = spinner();
analysisSpinner.start("Snooping around your repo...");

const git = simpleGit("../../clerk/migration-thing");

analysisSpinner.message("Checking the damage...");
const {
  files: _files,
  isClean: _isClean,
  ...statusResult
} = await git.status();
const status = statusResult;

analysisSpinner.message("Tallying up your changes...");
const diffSummary = await git.diffSummary();

analysisSpinner.message("Grabbing all the juicy details...");
const diff = await git.diff();

if (!diffSummary.files.length) {
  analysisSpinner.stop("Huh... squeaky clean. Nothing to see here.");
  outro("No changes? Seriously? Stop procrastinating and write some code! 🙄");
  process.exit(0);
}

analysisSpinner.stop(
  `${categorizeChangesCount(diffSummary.files.length)} Holy sh*t, you touched ${chalk.bold(`${diffSummary.files.length} file${diffSummary.files.length === 1 ? "" : "s"}`)}!`,
);

const prompt = userInstruction(status, diffSummary, diff);

log.info("Cooking up a spicy prompt for the AI overlords...");

const tokenCountSpinner = spinner();
tokenCountSpinner.start(
  "Doing some quick math (don't worry, it's not your job)...",
);

const [actualTokenCount, { duration: tokenCountDuration }] = time(() =>
  countTokens(prompt),
);
const category = categorizeTokenCount(actualTokenCount);

tokenCountSpinner.stop(
  `${category.emoji ? `${category.emoji} ` : ""}That's ${chalk.bold(`~${actualTokenCount} tokens`)} of pure chaos, ${category.label} ${tokenCountDuration > 50 ? chalk.dim(`(took ${tokenCountDuration}ms to count 'em)`) : ""}`,
);

if (category.needsConfirmation) {
  const shouldContinue = await confirm({
    message: `${chalk.bold(`${category.emoji ? `${category.emoji} ` : ""}Whoa there!`)} ${category.description}. ${chalk.italic.dim("You sure you want to burn those tokens?")}`,
    initialValue: false,
  });

  if (!shouldContinue) {
    outro("Smart move. Maybe split that monster diff next time? 🤔");
    process.exit(0);
  }
}

log.info("Time to make the AI earn its keep...");

const { elementStream } = streamObject({
  model: google("gemini-2.5-flash"),
  providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
  output: "array",
  schema: responseZodSchema,
  system: systemInstruction,
  prompt: userInstruction(status, diffSummary, diff),
});

const commitSpinner = spinner();
commitSpinner.start("Making commit messages that don't suck...");

let commitCount = 0;
for await (const commit of elementStream) {
  if (commitCount === 0) {
    commitSpinner.stop("Here come the goods...");
  } else {
    log.info("Another one coming in hot...");
  }

  const decapitalizedDescription = decapitalizeFirstLetter(commit.description);
  let typeScopeBreaking = `${commit.type}${commit.scope?.length ? `(${commit.scope})` : ""}${commit.breaking ? "!" : ""}`;
  if (decapitalizedDescription.startsWith(typeScopeBreaking)) {
    typeScopeBreaking = "";
  }

  log.message(chalk.gray("━━━"), { symbol: chalk.gray("│") });
  log.message(
    `${typeScopeBreaking ? `${chalk.bold(`${typeScopeBreaking}: `)}` : ""}${decapitalizedDescription}`,
    { symbol: chalk.gray("│") },
  );
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
    `Applies to these ${chalk.bold(`${commit.files.length} file${commit.files.length === 1 ? "" : "s"}`)}: ${chalk.dim(wrapText(commit.files.join(", ")))}`,
    {
      symbol: chalk.gray("│"),
    },
  );

  const shouldCommit = await confirm({
    message: `Ship it?`,
  });

  if (shouldCommit) {
    // let message = `${commit.type}${commit.scope?.length ? `(${commit.scope})` : ""}${commit.breaking ? "!" : ""}: `;
    // message += decapitalizeFirstLetter(commit.description);
    // if (commit.body?.length) message += `\n\n${commit.body}`;
    // if (commit.footers?.length) message += `\n\n${commit.footers.join("\n")}`;
    // try {
    //   await git.add(files);
    //   log.success(`Staged ${files.length} file(s)`);
    // } catch (error) {
    //   log.error(chalk.red("Failed to stage files"));
    //   log.error(chalk.dim(JSON.stringify(error, null, 2)));
    //   process.exit(1);
    // }
    // try {
    //   const commit = await git.commit(message, files);
    //   log.success(
    //     `Committed to ${commit.branch}: ${chalk.bold(commit.commit.slice(0, 7))} ${chalk.dim(
    //       `(${commit.summary.changes} changes, ${chalk.green(
    //         "+" + commit.summary.insertions,
    //       )}, ${chalk.red("-" + commit.summary.deletions)})`,
    //     )}`,
    //   );
    // } catch (error) {
    //   log.error(chalk.red("Commit failed"));
    //   log.error(chalk.dim(JSON.stringify(error, null, 2)));
    //   process.exit(1);
    // }

    commitCount++;
  } else {
    log.info("Your loss. Moving on...");
  }
}

outro(
  `Boom! ${commitCount} commit(s) that actually make sense. You're welcome. 🎤⬇️`,
);
