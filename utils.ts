import chalk from "chalk";

export const decapitalizeFirstLetter = (str: string) =>
  str.charAt(0).toLocaleLowerCase() + str.slice(1);

export type TimedResult<T> = [
  T,
  {
    start: number;
    end: number;
    duration: number;
  },
];

export function time<T>(operation: () => T): TimedResult<T>;
export function time<T>(operation: () => Promise<T>): Promise<TimedResult<T>>;
export function time<T>(
  operation: () => T | Promise<T>,
): TimedResult<T> | Promise<TimedResult<T>> {
  const start = performance.now();
  const result = operation();

  if (result instanceof Promise) {
    return result.then((value) => {
      const end = performance.now();
      const duration = Math.round(end - start);
      return [value, { start, end, duration }];
    });
  } else {
    const end = performance.now();
    const duration = Math.round(end - start);
    return [result, { start, end, duration }];
  }
}

export const categorizeChangesCount = (changesCount: number) => {
  if (changesCount < 10) return "Nice!";
  if (changesCount < 50) return chalk.bold("Solid!");
  if (changesCount < 100) return chalk.green("We cookin'!");
  return chalk.red("Better buy your reviewers coffee!");
};

export const categorizeTokenCount = (tokenCount: number) => {
  if (tokenCount < 5000) {
    return {
      emoji: "🟢",
      label: "looking fresh",
    };
  } else if (tokenCount < 15000) {
    return {
      emoji: "🟡",
      label: "totally fine",
    };
  } else if (tokenCount < 50000) {
    return {
      emoji: "🟠",
      label: "getting chunky",
    };
  } else if (tokenCount < 100000) {
    return {
      emoji: "🔴",
      label: "yikes territory",
      description:
        "This is gonna hurt your wallet and probably piss off the API gods",
      needsConfirmation: true,
    };
  } else {
    return {
      emoji: undefined,
      label: chalk.bold.red("an absolute unit 💀"),
      description:
        "Are you f*cking kidding me? This will cost a fortune and might literally melt the servers",
      needsConfirmation: true,
    };
  }
};

export const wrapText = (text: string, maxWidth: number = 80): string => {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    // If adding this word would exceed maxWidth
    if (
      currentLine.length + word.length + (currentLine.length > 0 ? 1 : 0) >
      maxWidth
    ) {
      // If current line is not empty, push it and start a new line
      if (currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        // If the word itself is longer than maxWidth, we have to add it as its own line
        lines.push(word);
      }
    } else {
      // Add word to current line
      currentLine += (currentLine.length > 0 ? " " : "") + word;
    }
  }

  // Don't forget the last line
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.join("\n");
};
