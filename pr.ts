import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import chalk from "chalk";
import { simpleGit } from "simple-git";
import { prInstruction, prZodSchema } from "./constants";
import { createPrompts } from "./prompts";
import { getErrorMessage, pluralize, wrapText } from "./utils";

export async function handlePullRequest({
  git,
  log,
  spinner,
  confirm,
  options,
}: {
  git: ReturnType<typeof simpleGit>;
  log: ReturnType<typeof createPrompts>["log"];
  spinner: ReturnType<typeof createPrompts>["spinner"];
  confirm: ReturnType<typeof createPrompts>["confirm"];
  options: { [key: string]: boolean };
}): Promise<void> {
  try {
    const branch = await git.revparse(["--abbrev-ref", "HEAD"]);
    const { value: remoteUrl } = await git.getConfig("remote.origin.url");

    if (!remoteUrl) {
      log.info("No remote? No PR. Push your code somewhere first! 🤷");
      return;
    }

    let baseBranch = "main";
    try {
      await git.revparse(["--verify", "origin/main"]);
    } catch {
      try {
        await git.revparse(["--verify", "origin/master"]);
        baseBranch = "master";
      } catch {
        log.info("No main or master branch? What kind of repo is this? 🤔");
        return;
      }
    }

    if (branch === baseBranch) {
      log.info(`You're on ${baseBranch} already. No PR needed, champ! 👑`);
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
      options["pr"] ||
      (await confirm({
        message: `Want me to cook up a PR for ${
          branchCommits.total
        } ${pluralize(branchCommits.total, "commit")}?`,
        initialValue: true,
      }));

    if (!shouldCreatePR) {
      return;
    }

    try {
      const unpushedCommits = await git.log([
        `origin/${branch}..HEAD`,
        "--oneline",
      ]);

      if (unpushedCommits.total > 0) {
        const shouldPush = await confirm({
          message: `Push ${unpushedCommits.total} unpushed ${pluralize(
            unpushedCommits.total,
            "commit",
          )} to origin/${branch}?`,
          initialValue: true,
        });

        if (!shouldPush) {
          return;
        }

        const pushSpinner = spinner();
        pushSpinner.start(
          `Pushing ${unpushedCommits.total} ${pluralize(
            unpushedCommits.total,
            "commit",
          )} to origin/${branch}...`,
        );

        await git.push("origin", branch);
        pushSpinner.stop("Pushed! Your code is now live and ready to PR");
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
    prSpinner.start("Getting the AI to write your PR...");

    const apiKey = process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
    if (!apiKey) {
      log.error("GOOGLE_GENERATIVE_AI_API_KEY is not set");
      process.exit(1);
    }
    const google = createGoogleGenerativeAI({ apiKey });

    const commits = await git.log([`origin/${baseBranch}..HEAD`]);

    const { object: prInfo } = await generateObject({
      model: google("gemini-2.5-flash"),
      schema: prZodSchema,
      prompt: prInstruction(commits.all),
    });

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

    if (!confirmPR) {
      return;
    }

    const tempFile = `/tmp/pr-body-${Date.now()}.md`;

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
      log.error(`F#ck! Couldn't open PR in browser: ${getErrorMessage(error)}`);
      log.info("Manual backup plan:");
      log.info(
        `${chalk.cyan(
          remoteUrl.replace(".git", ""),
        )}/compare/${baseBranch}...${branch}`,
      );
    } finally {
      try {
        await Bun.$`rm -f ${tempFile}`;
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    log.error(
      `Well sh#t, PR creation went sideways: ${getErrorMessage(error)}`,
    );
  }
}
