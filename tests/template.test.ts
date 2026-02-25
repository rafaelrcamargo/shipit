import { describe, expect, test } from "bun:test";

import { findPrTemplate } from "../template";

describe("findPrTemplate", () => {
  test("uses highest-priority single-template path when available", async () => {
    const git = {
      show: async ([ref]: string[]) => {
        if (ref === "HEAD:.github/PULL_REQUEST_TEMPLATE.md") {
          return "  ## Summary\n- item\n";
        }
        throw new Error("not found");
      },
      raw: async () => "",
    };

    const template = await findPrTemplate(git as never);
    expect(template).toEqual({
      content: "## Summary\n- item",
      source: ".github/PULL_REQUEST_TEMPLATE.md",
    });
  });

  test("falls back to .github/PULL_REQUEST_TEMPLATE directory", async () => {
    const git = {
      show: async ([ref]: string[]) => {
        if (ref === "HEAD:.github/PULL_REQUEST_TEMPLATE/backend.md") {
          return "  backend template body  ";
        }
        throw new Error("not found");
      },
      raw: async () =>
        ".github/PULL_REQUEST_TEMPLATE/backend.md\n.github/PULL_REQUEST_TEMPLATE/other.txt\n",
    };

    const template = await findPrTemplate(git as never);
    expect(template).toEqual({
      content: "backend template body",
      source: ".github/PULL_REQUEST_TEMPLATE/backend.md",
    });
  });

  test("returns null when no template exists", async () => {
    const git = {
      show: async () => {
        throw new Error("not found");
      },
      raw: async () => {
        throw new Error("missing dir");
      },
    };

    const template = await findPrTemplate(git as never);
    expect(template).toBeNull();
  });
});
