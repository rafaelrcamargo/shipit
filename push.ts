import type { SimpleGit } from "simple-git";
import type { Prompts } from "./prompts";
import { getErrorMessage, pluralize } from "./utils";

type PushHandlerParams = {
  git: SimpleGit;
  log: Prompts["log"];
  spinner: Prompts["spinner"];
};

export async function handlePush({
  git,
  log,
  spinner,
}: PushHandlerParams): Promise<void> {
  const pushSpinner = spinner();
  pushSpinner.start("Pushing to origin...");

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
      unpushedCommits = await git.log([
        `origin/${branch}..HEAD`,
        "--oneline",
      ]);
    } catch {
      // Remote tracking branch doesn't exist, this is likely the first push
      pushSpinner.message(`First push to origin/${branch}...`);
      await git.push("origin", branch, ["--set-upstream"]);
      pushSpinner.stop(`Pushed new branch to origin/${branch}`);
      return;
    }

    if (unpushedCommits.total === 0) {
      pushSpinner.stop("Nothing to push. Your branch is up to date. 👍");
    } else {
      pushSpinner.message(
        `Pushing ${unpushedCommits.total} ${pluralize(
          unpushedCommits.total,
          "commit",
        )} to origin/${branch}...`,
      );

      await git.push("origin", branch);
      pushSpinner.stop(
        `Pushed ${unpushedCommits.total} ${pluralize(
          unpushedCommits.total,
          "commit",
        )}`,
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
