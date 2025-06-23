import { intro, log, outro, spinner, taskLog } from "@clack/prompts";
import { GoogleGenAI } from "@google/genai";
import chalk from "chalk";
import { simpleGit } from "simple-git";
import {
  responseSchema,
  systemInstruction,
  userInstruction,
} from "./constants";
import type { ResponseSchema } from "./types";
import { decapitalizeFirstLetter } from "./utils";

intro(`AI Git Commit Assistant`);

const s = spinner();

s.start("Analyzing your repository...");

const git = simpleGit("../cmrg/");

let status, diffSummary, diff;

try {
  s.message("Checking repository status...");
  const {
    files: _files,
    isClean: _isClean,
    ...statusResult
  } = await git.status();
  status = statusResult;

  s.message("Generating diff summary...");
  diffSummary = await git.diffSummary();

  s.message("Capturing detailed changes...");
  diff = await git.diff();

  if (!diffSummary.files.length) {
    s.stop("No changes detected in repository");
    outro("Nothing to commit! Make some changes first.");
    process.exit(0);
  }

  s.stop(`Found ${diffSummary.files.length} modified file(s)`);
} catch (error) {
  s.stop("Failed to analyze repository");
  log.error("Could not access git repository. Are you in a git project?");
  log.error(chalk.dim(JSON.stringify(error, null, 2)));
  process.exit(1);
}

const task = taskLog({
  title: "Analyzing changes...",
});

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

let response;
try {
  response = await ai.models.generateContentStream({
    model: "gemini-2.5-flash",
    config: {
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
      responseSchema,
      systemInstruction,
    },
    contents: [
      {
        role: "user",
        parts: userInstruction(status, diffSummary, diff),
      },
    ],
  });
} catch (error) {
  task.error(chalk.red("AI request failed"));
  log.error(
    "Could not connect to AI service. Check your API key and connection.",
  );
  log.error(chalk.dim(JSON.stringify(error, null, 2)));
  process.exit(1);
}

let stream = "";
try {
  for await (const chunk of response) {
    if (chunk.text) {
      task.message(chunk.text);
      stream += chunk.text;
    }
  }
} catch (error) {
  task.error(chalk.red("Failed to process AI response"));
  log.error("Something went wrong while generating commit messages.");
  log.error(chalk.dim(JSON.stringify(error, null, 2)));
  process.exit(1);
}

task.success("Generated commit messages");

let commitMessages;
try {
  commitMessages = JSON.parse(stream) as ResponseSchema;
} catch (_error) {
  log.error(chalk.red("Failed to parse AI response - received invalid format"));
  log.error(chalk.dim("Raw response: " + stream));
  process.exit(1);
}

for (const {
  files,
  type,
  scope,
  breaking,
  description,
  body,
  footers,
} of commitMessages) {
  let message = `${type}${scope?.length ? `(${scope})` : ""}${breaking ? "!" : ""}: `;
  message += decapitalizeFirstLetter(description);
  if (body?.length) message += `\n\n${body}`;
  if (footers?.length) message += `\n\n${footers.join("\n")}`;

  log.step(chalk.dim(message));

  try {
    await git.add(files);
    log.success(`Staged ${files.length} file(s)`);
  } catch (error) {
    log.error(chalk.red("Failed to stage files"));
    log.error(chalk.dim(JSON.stringify(error, null, 2)));
    process.exit(1);
  }

  try {
    const commit = await git.commit(message, files);
    log.success(
      `Committed to ${commit.branch}: ${chalk.bold(commit.commit.slice(0, 7))} ${chalk.dim(
        `(${commit.summary.changes} changes, ${chalk.green(
          "+" + commit.summary.insertions,
        )}, ${chalk.red("-" + commit.summary.deletions)})`,
      )}`,
    );
  } catch (error) {
    log.error(chalk.red("Commit failed"));
    log.error(chalk.dim(JSON.stringify(error, null, 2)));
    process.exit(1);
  }
}

outro(`Done. Created ${commitMessages.length} commit(s).`);
