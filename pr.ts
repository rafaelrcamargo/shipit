import { generateObject, type LanguageModel } from "ai";
import chalk from "chalk";
import type { SimpleGit } from "simple-git";
import { prInstruction, prSchema } from "./constants";
import type { Prompts } from "./prompts";
import { findPrTemplate } from "./template";
import { getBaseBranch, getErrorMessage, pluralize, wrapText } from "./utils";

type PrHandlerParams = {
  git: SimpleGit;
  log: Prompts["log"];
  confirm: Prompts["confirm"];
  progressGroup: Prompts["progressGroup"];
  options: { [key: string]: boolean };
  model: LanguageModel;
};

export async function handlePullRequest({
  git,
  log,
  confirm,
  progressGroup,
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

        await progressGroup([
          {
            name: `Pushing ${unpushedCommits.total} ${pluralize(
              unpushedCommits.total,
              "commit",
            )} to origin/${branch}`,
            action: async () => {
              await git.push("origin", branch);
            },
          },
        ]);
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

    let template: Awaited<ReturnType<typeof findPrTemplate>>;
    let commits: Awaited<ReturnType<SimpleGit["log"]>>;
    let prInfo: { title: string; body: string } | undefined;

    await progressGroup([
      {
        name: "Checking for PR template",
        action: async () => {
          template = await findPrTemplate(git);
          if (template) {
            log.info(
              `Found PR template at ${chalk.cyan(template.source)} - following repository guidelines! 📝`,
            );
          }
        },
      },
      {
        name: "Getting commit history",
        action: async () => {
          commits = await git.log([`origin/${baseBranch}..HEAD`]);
        },
      },
      {
        name: "Getting AI to write your PR",
        action: async () => {
          const result = await generateObject({
            model,
            schema: prSchema,
            prompt: prInstruction(
              commits.all as never[],
              template || undefined,
            ),
          });
          prInfo = result.object;
        },
      },
    ]);

    if (!prInfo) {
      log.error("Failed to generate PR information");
      return;
    }

    log.message(chalk.bold("PR Title:"), { symbol: chalk.gray("│") });
    log.message(prInfo.title, { symbol: chalk.gray("│") });
    log.message(chalk.bold("PR Body:"), { symbol: chalk.gray("│") });
    log.message(chalk.dim(wrapText(prInfo.body, 60)), {
      symbol: chalk.gray("│"),
    });

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
      log.error(`Dang! Couldn't open PR in browser: ${getErrorMessage(error)}`);
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
      `Well sh*t, PR creation went sideways: ${getErrorMessage(error)}`,
    );
  }
}
