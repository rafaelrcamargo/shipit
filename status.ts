import chalk from "chalk";
import { simpleGit } from "simple-git";

import { GITHUB_CONTEXT_DISABLE_ENV, isGithubContextDisabled } from "./context";
import { version } from "./package.json" with { type: "json" };
import { providerRegistryById } from "./registry";
import { resolveProviderConfig } from "./resolution";
import { formatDisplayPath, getBaseBranch } from "./utils";

type ProviderId = keyof typeof providerRegistryById;

type StatusRow = {
  label: string;
  value: string;
};

type StatusSection = {
  title: string;
  rows: StatusRow[];
};

const providerEntries = Object.entries(providerRegistryById) as Array<
  [ProviderId, (typeof providerRegistryById)[ProviderId]]
>;

const hasEnvValue = (name: string) => Boolean(process.env[name]?.trim());

const envStatus = (name: string) =>
  hasEnvValue(name) ? chalk.green("configured") : chalk.dim("missing");

const valueStatus = (name: string) => {
  const value = process.env[name]?.trim();
  return value ? chalk.cyan(value) : chalk.dim("unset");
};

const sanitizeRemoteUrl = (remoteUrl: string | undefined) => {
  if (!remoteUrl) return undefined;
  return remoteUrl.replace(/\/\/([^/@]+)@/, "//<credentials>@");
};

const runCommand = async (
  command: string,
  args: string[],
): Promise<number | undefined> => {
  try {
    const proc = Bun.spawn([command, ...args], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return await proc.exited;
  } catch {
    return undefined;
  }
};

const getProviderSelection = () => {
  try {
    const config = resolveProviderConfig();
    const source = hasEnvValue("SHIPIT_PROVIDER")
      ? "SHIPIT_PROVIDER override"
      : `${config.requiredApiKeyEnv} fallback`;

    return [
      {
        label: "Provider",
        value: `${chalk.bold(config.provider)} (${config.id})`,
      },
      {
        label: "Model",
        value: `${chalk.bold(config.name)} (${config.modelId})`,
      },
      { label: "Selection", value: source },
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      { label: "Provider", value: chalk.red("not resolved") },
      { label: "Reason", value: message },
    ];
  }
};

const getGitStatus = async (cwd: string) => {
  const git = simpleGit(cwd);

  if (!(await git.checkIsRepo().catch(() => false))) {
    return [{ label: "Repository", value: "not a git repo" }];
  }

  const [branch, remoteConfig, status] = await Promise.all([
    git.revparse(["--abbrev-ref", "HEAD"]).catch(() => undefined),
    git.getConfig("remote.origin.url").catch(() => ({ value: undefined })),
    git.status().catch(() => undefined),
  ]);
  const baseBranch = await getBaseBranch(git).catch(() => undefined);
  const remoteUrl = sanitizeRemoteUrl(remoteConfig.value ?? undefined);

  return [
    { label: "Repository", value: "git repo" },
    { label: "Branch", value: branch ?? "unknown" },
    { label: "Base branch", value: baseBranch ?? "not found" },
    { label: "Remote origin", value: remoteUrl ?? "not configured" },
    {
      label: "Changed files",
      value: String(status?.files.length ?? "unknown"),
    },
  ];
};

const getGhStatus = async () => {
  if (isGithubContextDisabled()) {
    return `not checked; ${GITHUB_CONTEXT_DISABLE_ENV}=1`;
  }

  const versionStatus = await runCommand("gh", ["--version"]);
  if (versionStatus !== 0) {
    return "not installed";
  }

  const authStatus = await runCommand("gh", ["auth", "status"]);
  if (authStatus === undefined) return "installed, auth unknown";

  return authStatus === 0
    ? "installed and authenticated"
    : "installed, not authenticated";
};

const renderTable = (section: StatusSection) => {
  const labelWidth = Math.max(
    "Item".length,
    ...section.rows.map((row) => row.label.length),
  );
  const header = `${"Item".padEnd(labelWidth)}  Value`;
  const separator = `${"-".repeat(labelWidth)}  ${"-".repeat(5)}`;
  const rows = section.rows.map(
    (row) => `${row.label.padEnd(labelWidth)}  ${row.value}`,
  );

  return `${chalk.bold(section.title)}\n  ${chalk.dim(header)}\n  ${chalk.dim(separator)}\n${rows.map((row) => `  ${row}`).join("\n")}`;
};

export const renderStatus = async (cwd = process.cwd()) => {
  const ghStatus = await getGhStatus();
  const linearApiConfigured = hasEnvValue("LINEAR_API_KEY");
  const githubContextDisabled = isGithubContextDisabled();
  const sections = [
    {
      title: "shipit",
      rows: [
        { label: "Version", value: version },
        { label: "Working directory", value: formatDisplayPath(cwd) },
      ],
    },
    {
      title: "AI Provider",
      rows: getProviderSelection(),
    },
    {
      title: "Provider API Keys",
      rows: providerEntries.map(([, provider]) => ({
        label: provider.requiredApiKeyEnv,
        value: envStatus(provider.requiredApiKeyEnv),
      })),
    },
    {
      title: "Overrides",
      rows: [
        { label: "SHIPIT_PROVIDER", value: valueStatus("SHIPIT_PROVIDER") },
        { label: "SHIPIT_MODEL", value: valueStatus("SHIPIT_MODEL") },
        {
          label: GITHUB_CONTEXT_DISABLE_ENV,
          value: valueStatus(GITHUB_CONTEXT_DISABLE_ENV),
        },
      ],
    },
    {
      title: "Context Integrations",
      rows: [
        { label: "LINEAR_API_KEY", value: envStatus("LINEAR_API_KEY") },
        {
          label: "Linear issue details",
          value: linearApiConfigured
            ? "enabled"
            : "disabled; set LINEAR_API_KEY to fetch details",
        },
        {
          label: "Ticket IDs",
          value: "--ticket values are included even without Linear details",
        },
        {
          label: "GitHub context",
          value: githubContextDisabled
            ? `disabled by ${GITHUB_CONTEXT_DISABLE_ENV}=1`
            : "enabled when gh is installed and authenticated",
        },
        { label: "GitHub CLI", value: ghStatus },
      ],
    },
    {
      title: "Git",
      rows: await getGitStatus(cwd),
    },
  ] satisfies StatusSection[];

  return sections.map(renderTable).join("\n\n");
};

export const printStatus = async (cwd = process.cwd()) => {
  console.log(await renderStatus(cwd));
};
