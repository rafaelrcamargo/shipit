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

intro(`Generating commit message...`);

const s = spinner();

s.start("Gathering git information...");

const git = simpleGit("../cmrg/");

const { files: _files, isClean: _isClean, ...status } = await git.status();
const diffSummary = await git.diffSummary();
const diff = await git.diff();

s.stop("Git information gathered successfully");

const task = taskLog({
  title: "Asking AI to generate commit message...",
});

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const model = "gemini-2.5-flash";
const config = {
  thinkingConfig: {
    thinkingBudget: 0,
  },
  responseMimeType: "application/json",
  responseSchema,
  systemInstruction,
};

let stream = "";
const response = await ai.models.generateContentStream({
  model,
  config,
  contents: [
    {
      role: "user",
      parts: userInstruction(status, diffSummary, diff),
    },
  ],
});
for await (const chunk of response) {
  if (chunk.text) {
    task.message(chunk.text);
    stream += chunk.text;
  }
}

task.success("Commit message generated successfully");

const commitMessages = JSON.parse(stream) as ResponseSchema;

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
    log.success("Added files to staging area");
  } catch (error) {
    log.error(chalk.red("Failed to add files to staging area"));
    log.error(chalk.dim(JSON.stringify(error, null, 2)));
    process.exit(1);
  }

  try {
    const commit = await git.commit(message, files);
    log.success(
      `${commit.branch}: ${commit.commit} ${chalk.dim(
        `(${commit.summary.changes} changes, ${chalk.green(
          "+" + commit.summary.insertions,
        )}, ${chalk.red("-" + commit.summary.deletions)})`,
      )}`,
    );
  } catch (error) {
    log.error(chalk.red("Failed to commit files"));
    log.error(chalk.dim(JSON.stringify(error, null, 2)));
    process.exit(1);
  }
}

outro(`You're all set!`);
