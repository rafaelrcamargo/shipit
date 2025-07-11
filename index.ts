import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject, streamObject } from "ai";
import { CAC } from "cac";
import chalk from "chalk";
import { countTokens } from "gpt-tokenizer";
import { simpleGit } from "simple-git";
import { z } from "zod";
import { createClack } from "./clack.ts";
import {
  responseZodSchema,
  systemInstruction,
  userInstruction,
} from "./constants.ts";
import { version } from "./package.json" with { type: "json" };
import {
  categorizeChangesCount,
  categorizeTokenCount,
  decapitalizeFirstLetter,
  pluralize,
  wrapText,
} from "./utils.ts";

const cli = new CAC();

cli
  .command(
    "[...files]",
    "Create a new commit containing the current contents of the index and generate a log message describing the changes.",
  )
  .option("-f,--force", "Auto accept all commits and skip confirmation")
  .option("-u,--unsafe", "Skip token count verification")
  .option(
    "-s,--silent",
    "No output is logged to the console, except fatal errors",
  );

cli.help();
cli.version(version);

const { args, options } = cli.parse();

// Early exit if help or version is requested
if (options.help || options.version) process.exit(0);

async function main() {
  // We wrap the clack library in a function to allow for silent mode and force mode
  const { log, note, outro, spinner, confirm } = createClack({
    silent: options.silent,
    force: options.force,
  });

  note(
    chalk.italic("Because writing 'fix stuff' gets old real quick..."),
    chalk.bold("🧹 Git Your Sh*t Together"),
  );

  log.info("Let's see what mess you've made this time...");

  const analysisSpinner = spinner();
  analysisSpinner.start("Snooping around your repo...");

  // Initialize git instance on the current working directory
  const git = simpleGit(process.cwd());

  // Check if the current directory is a git repository
  if (!(await git.checkIsRepo())) {
    analysisSpinner.stop("❌ Well, this is awkward...");
    outro(
      "Not a git repo? What the f*ck are you trying to commit here? Run 'git init' first! 🤦",
    );
    process.exit(1);
  }

  analysisSpinner.message("Checking the damage...");
  const {
    files: _files,
    isClean,
    ...status
  } = await git.status(args as string[]);

  if (isClean()) {
    analysisSpinner.stop("Huh... squeaky clean. Nothing to see here.");
    outro("No changes? Nothing to commit here. Time to write some code! 🙄");
    process.exit(0);
  }

  if (status.conflicted && status.conflicted.length > 0) {
    analysisSpinner.stop("💥 You have merge conflicts!");
    outro(
      `Holy sh*t! Fix your ${status.conflicted.length} ${pluralize(status.conflicted.length, "conflict")} first: ${status.conflicted.join(", ")}`,
    );
    process.exit(1);
  }

  if (args.length > 0) {
    analysisSpinner.message("Sniffing out your specified paths...");

    if (status.staged && status.staged.length > 0) {
      analysisSpinner.stop("⚠️  Hold up! Mixed signals detected!");
      outro(`You've got staged files AND specified paths? That's a recipe for disaster.

Pick a lane:
- Unstage your sh*t: git reset
- Commit the staged stuff first: git commit
- Or YOLO it without paths to handle everything`);
      process.exit(1);
    }
  }

  analysisSpinner.message("Counting your sins...");
  const diffSummary = await git.diffSummary(args as string[]);

  analysisSpinner.message("Grabbing all the juicy details...");
  const diff = await git.diff(args as string[]);

  analysisSpinner.stop(
    `${categorizeChangesCount(diffSummary.files.length)} You've touched ${chalk.bold(`${diffSummary.files.length} ${pluralize(diffSummary.files.length, "file")}`)}!`,
  );

  const prompt = userInstruction(status, diffSummary, diff);

  log.info("Cooking up a spicy prompt for the AI...");

  const tokenCountSpinner = spinner();
  tokenCountSpinner.start(
    "Doing some quick math (don't worry, it's not your job)...",
  );

  const actualTokenCount = countTokens(prompt);
  const category = categorizeTokenCount(actualTokenCount);

  tokenCountSpinner.stop(
    `${category.emoji ? `${category.emoji} ` : ""}That's ${chalk.bold(`~${actualTokenCount} tokens`)} of pure chaos, ${category.label}`,
  );

  if (category.needsConfirmation && !options.unsafe) {
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

  const google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });

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
    } else {
      log.info("Oh sh*t, another banger incoming...");
    }

    const description = decapitalizeFirstLetter(commit.description);
    let prefix = `${commit.type}${commit.scope?.length ? `(${commit.scope})` : ""}${commit.breaking ? "!" : ""}`;

    if (description.startsWith(prefix)) {
      prefix = "";
    }

    const displayMessage = `${prefix ? `${chalk.bold(`${prefix}: `)}` : ""}${description}`;
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
      `Applies to these ${chalk.bold(`${commit.files.length} ${pluralize(commit.files.length, "file")}`)}: ${chalk.dim(wrapText(commit.files.join(", ")))}`,
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
        log.success(
          `Staged ${commit.files.length} ${pluralize(commit.files.length, "file")}`,
        );
      } catch (error) {
        log.error(chalk.red("Well sh*t, couldn't stage the files"));
        log.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }

      try {
        const COMMIT_HASH_LENGTH = 7;
        const commitResult = await git.commit(message, commit.files);
        log.success(
          `Committed to ${commitResult.branch}: ${chalk.bold(commitResult.commit.slice(0, COMMIT_HASH_LENGTH))} ${chalk.dim(
            `(${commitResult.summary.changes} changes, ${chalk.green(
              "+" + commitResult.summary.insertions,
            )}, ${chalk.red("-" + commitResult.summary.deletions)})`,
          )}`,
        );
      } catch (error) {
        log.error(chalk.red("F*ck! The commit crashed and burned"));
        log.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }

      commitCount++;
    } else {
      log.info("Your loss, champ. Next!");
    }
  }

  if (commitCount > 0) {
    // Check if we have a remote and are on a branch that can create PRs
    try {
      const branch = await git.revparse(["--abbrev-ref", "HEAD"]);
      const { value: remoteUrl } = await git.getConfig("remote.origin.url");

      if (!remoteUrl) {
        log.info("No remote origin found. Skipping PR creation.");
        return;
      }

      // Determine the base branch (main or master)
      let baseBranch = "main";
      try {
        await git.revparse(["--verify", "origin/main"]);
      } catch {
        try {
          await git.revparse(["--verify", "origin/master"]);
          baseBranch = "master";
        } catch {
          log.info("No main or master branch found. Skipping PR creation.");
          return;
        }
      }

      // Skip PR creation if we're on the base branch
      if (branch === baseBranch) {
        log.info(`Already on ${baseBranch} branch. No PR needed.`);
        return;
      }

      // Get all commits on this branch that aren't on the base branch
      const branchCommits = await git.log([
        `origin/${baseBranch}..HEAD`,
        "--oneline",
      ]);

      if (branchCommits.total === 0) {
        log.info(`No commits ahead of ${baseBranch}. Nothing to PR.`);
        return;
      }

      console.log(branchCommits);

      const shouldCreatePR = await confirm({
        message: `Want me to cook up a PR for ${branchCommits.total} ${pluralize(branchCommits.total, "commit")}?`,
        initialValue: true,
      });

      if (!shouldCreatePR) {
        return;
      }

      // Check if we need to push commits
      try {
        const unpushedCommits = await git.log([
          `origin/${branch}..HEAD`,
          "--oneline",
        ]);

        if (unpushedCommits.total > 0) {
          const shouldPush = await confirm({
            message: `Push ${unpushedCommits.total} unpushed ${pluralize(unpushedCommits.total, "commit")} to origin/${branch}?`,
            initialValue: true,
          });

          if (!shouldPush) {
            log.info(
              "Skipping push. You'll need to push manually before creating the PR.",
            );
            return;
          }

          const pushSpinner = spinner();
          pushSpinner.start(
            `Pushing ${unpushedCommits.total} ${pluralize(unpushedCommits.total, "commit")} to origin/${branch}...`,
          );

          await git.push("origin", branch);
          pushSpinner.stop("✅ Commits pushed successfully!");
        }
      } catch (error) {
        log.error(
          "Failed to push commits. You'll need to push manually first.",
        );
        log.error(error instanceof Error ? error.message : String(error));
        return;
      }

      const prSpinner = spinner();
      prSpinner.start("Summoning the AI to write your PR...");

      // Get detailed commit info for the PR
      const commits = await git.log([
        `origin/${baseBranch}..HEAD`,
        "--pretty=format:%H|%s|%b|--END--",
      ]);

      // Format commits for the prompt
      const formattedCommits = commits.all.map((commit) => {
        const [hash, subject, ...bodyParts] = commit.hash.split("|");
        const body = bodyParts.join("|").replace("|--END--", "").trim();
        return {
          hash: hash?.substring(0, 7) || commit.hash.substring(0, 7),
          subject: subject || "",
          body: body || undefined,
        };
      });

      // Create a prompt for PR generation
      const prPrompt = `Based on these commits, generate a concise PR title and a detailed PR body that explains the changes:

Commits:
${formattedCommits.map((c) => `- ${c.subject}${c.body ? `\n  ${c.body.split("\n").join("\n  ")}` : ""}`).join("\n")}

Generate:
1. A PR title (max 72 chars) that summarizes all changes
2. A PR body that:
   - Summarizes what changed and why
   - Lists the key changes as bullet points
   - Mentions any breaking changes or important notes
   - Is written in markdown format`;
      console.log(prPrompt);

      const { object: prInfo } = await generateObject({
        model: google("gemini-2.5-flash"),
        schema: z.object({
          title: z.string().describe("PR title, max 72 characters"),
          body: z.string().describe("PR body with markdown formatting"),
        }),
        prompt: prPrompt,
      });

      prSpinner.stop("✨ PR info generated!");

      log.message("");
      log.message(chalk.bold("PR Title:"));
      log.message(prInfo.title);
      log.message("");
      log.message(chalk.bold("PR Body:"));
      log.message(prInfo.body);
      log.message("");

      const confirmPR = await confirm({
        message: "Look good? Let's open it in your browser to edit and create!",
        initialValue: true,
      });

      if (!confirmPR) {
        return;
      }

      // Create PR using gh CLI
      const tempFile = `/tmp/pr-body-${Date.now()}.md`;

      try {
        await Bun.write(tempFile, prInfo.body);

        // Use gh pr create --web to open in browser with pre-filled content
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
          log.error(`GitHub CLI error: ${errors}`);
        }

        if (
          output.includes("Opening") ||
          output.includes("https://") ||
          errors.includes("Opening")
        ) {
          log.success(
            "🚀 PR draft opened in your browser! Edit and create when ready.",
          );

          // Try to extract and display the URL
          const urlMatch = (output + errors).match(/https:\/\/[^\s]+/);
          if (urlMatch) {
            log.info(`URL: ${chalk.cyan(urlMatch[0])}`);
          }
        }
      } catch (error) {
        log.error(
          "Failed to open PR in browser. You might need to install 'gh' CLI or authenticate.",
        );
        log.error(error instanceof Error ? error.message : String(error));

        // Show manual instructions
        log.info("");
        log.info("To create the PR manually:");
        log.info(
          `1. Go to: ${remoteUrl.replace(".git", "")}/compare/${baseBranch}...${branch}`,
        );
        log.info("2. Use the title and body shown above");
      } finally {
        // Always clean up temp file
        try {
          await Bun.$`rm -f ${tempFile}`;
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      log.error("Failed to check git status for PR creation");
      log.error(error instanceof Error ? error.message : String(error));
    }
  }

  outro(
    `Boom! ${commitCount} ${pluralize(commitCount, "commit")} that actually ${pluralize(commitCount, "makes", "make")} sense. You're welcome.`,
  );
}

main();
