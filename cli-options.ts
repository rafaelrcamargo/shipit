export type RawCliOptions = {
  yes?: boolean;
  y?: boolean;
  skipTokenCheck?: boolean;
  push?: boolean;
  p?: boolean;
  pr?: boolean;
  pullRequest?: boolean;
  context?: string | boolean;
};

export type NormalizedCliOptions = {
  yes: boolean;
  skipTokenCheck: boolean;
  push: boolean;
  createPullRequest: boolean;
  context?: string;
  ticketIds: string[];
};

const TICKET_ID_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/i;
const MAX_TICKET_IDS = 5;

const failRemovedFlag = (flag: string): never => {
  const replacement =
    flag === "--force" || flag === "-f"
      ? "--yes"
      : flag === "--unsafe" || flag === "-u"
        ? "--skip-token-check"
        : "--context";
  throw new Error(`${flag} was removed. Use ${replacement} instead.`);
};

const rejectRemovedFlags = (argv: string[]) => {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === "--") return;

    if (arg === "--context" || arg === "--ticket" || arg === "-t") {
      index++;
      continue;
    }
    if (arg.startsWith("--context=") || arg.startsWith("--ticket=")) {
      continue;
    }

    if (arg === "--force" || arg.startsWith("--force=")) {
      failRemovedFlag("--force");
    }
    if (arg === "--unsafe" || arg.startsWith("--unsafe=")) {
      failRemovedFlag("--unsafe");
    }
    if (arg === "--appendix" || arg.startsWith("--appendix=")) {
      failRemovedFlag("--appendix");
    }

    if (arg === "-f") failRemovedFlag("-f");
    if (arg === "-u") failRemovedFlag("-u");
    if (arg === "-a" || arg.startsWith("-a")) failRemovedFlag("-a");

    if (arg.startsWith("-") && !arg.startsWith("--") && !arg.startsWith("-t")) {
      if (arg.includes("f")) failRemovedFlag("-f");
      if (arg.includes("u")) failRemovedFlag("-u");
      if (arg.includes("a")) failRemovedFlag("-a");
    }
  }
};

const readOptionValue = (argv: string[], index: number, flag: string) => {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`${flag} requires a ticket ID.`);
  }
  return value;
};

const collectTicketValues = (argv: string[]): string[] => {
  const values: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === "--") break;

    if (arg === "--ticket") {
      values.push(readOptionValue(argv, index, "--ticket"));
      index++;
      continue;
    }

    if (arg.startsWith("--ticket=")) {
      values.push(arg.slice("--ticket=".length));
      continue;
    }

    if (arg === "-t") {
      values.push(readOptionValue(argv, index, "-t"));
      index++;
    }
  }

  return values;
};

const normalizeContext = (context: string | boolean | undefined) => {
  if (context === undefined) return undefined;
  if (typeof context !== "string") {
    throw new Error("--context requires text.");
  }

  return context.trim() ? context : undefined;
};

export const normalizeTicketIds = (values: string[]): string[] => {
  const ticketIds: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const ticketId = value.trim().toUpperCase();
    if (!TICKET_ID_PATTERN.test(ticketId)) {
      throw new Error(
        `Invalid ticket ID "${value}". Expected a value like ENG-123.`,
      );
    }
    if (seen.has(ticketId)) continue;
    seen.add(ticketId);
    ticketIds.push(ticketId);
  }

  if (ticketIds.length > MAX_TICKET_IDS) {
    throw new Error(
      `Too many ticket IDs (${ticketIds.length}). Pass at most ${MAX_TICKET_IDS}.`,
    );
  }

  return ticketIds;
};

export const normalizeCliOptions = (
  options: RawCliOptions,
  argv: string[],
): NormalizedCliOptions => {
  rejectRemovedFlags(argv);

  return {
    yes: options.yes === true || options.y === true,
    skipTokenCheck: options.skipTokenCheck === true,
    push: options.push === true || options.p === true,
    createPullRequest: options.pr === true || options.pullRequest === true,
    context: normalizeContext(options.context),
    ticketIds: normalizeTicketIds(collectTicketValues(argv)),
  };
};
