import { describe, expect, test } from "bun:test";

import { formatDisplayPath, formatDisplayPathChange } from "../utils";

describe("formatDisplayPath", () => {
  test("keeps short relative paths unchanged", () => {
    expect(formatDisplayPath("src/components/button.tsx")).toBe(
      "src/components/button.tsx",
    );
  });

  test("keeps the first segment and last two directories plus file", () => {
    expect(formatDisplayPath("apps/web/src/components/button/index.tsx")).toBe(
      "apps/.../components/button/index.tsx",
    );
  });

  test("preserves the leading slash and root segment for long absolute paths", () => {
    expect(formatDisplayPath("/Users/cmrg/code/mine/shipit")).toBe(
      "/Users/.../mine/shipit",
    );
  });

  test("normalizes windows separators for display", () => {
    expect(formatDisplayPath("apps\\web\\src\\components\\button.tsx")).toBe(
      "apps/.../src/components/button.tsx",
    );
  });
});

describe("formatDisplayPathChange", () => {
  test("truncates both sides of a rename independently", () => {
    expect(
      formatDisplayPathChange({
        fromPath: "packages/app/src/old/location/component.tsx",
        path: "packages/app/src/new/location/component.tsx",
      }),
    ).toBe(
      "packages/.../old/location/component.tsx -> packages/.../new/location/component.tsx",
    );
  });
});
