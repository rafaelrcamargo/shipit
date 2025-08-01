import { simpleGit } from "simple-git";
import { createPrompts } from "./prompts";
import { getErrorMessage, pluralize } from "./utils";

export async function handlePush({
  git,
  log,
  spinner,
}: {
  git: ReturnType<typeof simpleGit>;
  log: ReturnType<typeof createPrompts>["log"];
  spinner: ReturnType<typeof createPrompts>["spinner"];
}): Promise<void> {
  const pushSpinner = spinner();
  pushSpinner.start("Pushing to origin...");

  try {
    const branch = await git.revparse(["--abbrev-ref", "HEAD"]);
    const { value: remoteUrl } = await git.getConfig("remote.origin.url");

    if (!remoteUrl) {
      log.info("No remote? No push. Your code is safe... for now 🤷");
      return;
    }

    const unpushedCommits = await git.log([
      `origin/${branch}..HEAD`,
      "--oneline",
    ]);

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
