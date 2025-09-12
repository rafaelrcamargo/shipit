import type { SimpleGit } from "simple-git";
import type { Prompts } from "./prompts";
import { getErrorMessage, summarizeChanges } from "./utils";

type PushHandlerParams = {
  git: SimpleGit;
  log: Prompts["log"];
  progressGroup: Prompts["progressGroup"];
};

export async function handlePush({
  git,
  log,
  progressGroup,
}: PushHandlerParams): Promise<void> {
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
    } catch {
      // Remote tracking branch doesn't exist, this is likely the first push
      await progressGroup([
        {
          name: `First push to origin/${branch}`,
          action: async () => {
            await git.push("origin", branch, ["--set-upstream"]);
          },
        },
      ]);
      return;
    }

    if (unpushedCommits.total === 0) {
      log.info("Nothing to push. Your branch is up to date. 👍");
    } else {
      await progressGroup([
        {
          name: `Pushing ${summarizeChanges({ commits: unpushedCommits.total })} to origin/${branch}`,
          action: async () => {
            await git.push("origin", branch);
          },
        },
      ]);
    }
  } catch (error) {
    log.error(
      `Push failed! You'll need to handle that manually: ${getErrorMessage(
        error,
      )}`,
    );
  }
}
