import type { SimpleGit } from "simple-git";

import type { Prompts } from "./prompts";
import { getErrorMessage, pluralize } from "./utils";

const isMissingTrackingBranchError = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase();

  return (
    message.includes("unknown revision") ||
    message.includes("bad revision") ||
    (message.includes("ambiguous argument") &&
      message.includes("not in the working tree"))
  );
};

type PushHandlerParams = {
  git: SimpleGit;
  log: Prompts["log"];
  spinner: Prompts["spinner"];
  confirm: Prompts["confirm"];
  createdCommitHashes: string[];
};

export async function handlePush({
  git,
  log,
  spinner,
  confirm,
  createdCommitHashes,
}: PushHandlerParams): Promise<void> {
  const pushSpinner = spinner();
  pushSpinner.start("Pushing to origin...");
  const createdCommitSet = new Set(createdCommitHashes);

  try {
    const branch = await git.revparse(["--abbrev-ref", "HEAD"]);
    const { value: remoteUrl } = await git.getConfig("remote.origin.url");

    if (!remoteUrl) {
      log.info("No remote? No push. Your code is safe... for now 🤷");
      return;
    }

    // Check if remote tracking branch exists
    let unpushedCommits;
    try {
      unpushedCommits = await git.log([`origin/${branch}..HEAD`, "--oneline"]);
    } catch (error) {
      if (!isMissingTrackingBranchError(error)) {
        throw error;
      }

      const shouldPushFirstBranch = await confirm({
        message:
          createdCommitSet.size > 0
            ? `This is the first push to origin/${branch}. Push now?`
            : `No new commits were created by shipit. Push existing branch history to origin/${branch}?`,
        initialValue: createdCommitSet.size > 0,
      });

      if (shouldPushFirstBranch !== true) {
        pushSpinner.stop("Skipped push.");
        return;
      }

      pushSpinner.message(`First push to origin/${branch}...`);
      await git.push("origin", branch, ["--set-upstream"]);
      pushSpinner.stop(`Pushed new branch to origin/${branch}`);
      return;
    }

    if (unpushedCommits.total === 0) {
      pushSpinner.stop("Nothing to push. Your branch is up to date. 👍");
    } else {
      const unpushedNotCreatedByShipit = unpushedCommits.all.filter(
        (commit) => !createdCommitSet.has(commit.hash),
      );

      let shouldPush = true;
      if (createdCommitSet.size === 0) {
        shouldPush =
          (await confirm({
            message: `No new shipit commits were created. Push ${unpushedCommits.total} existing unpushed ${pluralize(
              unpushedCommits.total,
              "commit",
            )} anyway?`,
            initialValue: false,
          })) === true;
      } else if (unpushedNotCreatedByShipit.length > 0) {
        shouldPush =
          (await confirm({
            message: `${unpushedNotCreatedByShipit.length} unpushed ${pluralize(
              unpushedNotCreatedByShipit.length,
              "commit",
            )} were not created by shipit in this run. Push everything anyway?`,
            initialValue: false,
          })) === true;
      }

      if (!shouldPush) {
        pushSpinner.stop("Skipped push.");
        return;
      }

      pushSpinner.message(
        `Pushing ${unpushedCommits.total} ${pluralize(
          unpushedCommits.total,
          "commit",
        )} to origin/${branch}...`,
      );

      await git.push("origin", branch);
      pushSpinner.stop(
        `Successfully pushed ${unpushedCommits.total} ${pluralize(
          unpushedCommits.total,
          "commit",
        )} to origin/${branch}!`,
      );
    }
  } catch (error) {
    pushSpinner.stop(
      `Push failed! You'll need to handle that manually: ${getErrorMessage(
        error,
      )}`,
    );
  }
}
