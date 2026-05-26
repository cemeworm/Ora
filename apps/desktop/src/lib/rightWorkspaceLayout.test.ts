import { describe, expect, it } from "vitest";
import {
  clampRightWorkspaceWidth,
  getRightWorkspaceMaxWidth,
  RIGHT_WORKSPACE_MAIN_CONTENT_WIDTH_PX,
  RIGHT_WORKSPACE_MIN_DETAIL_PANEL_WIDTH,
} from "./rightWorkspaceLayout";

describe("right workspace layout", () => {
  it("keeps enough room for the chat input plus a small buffer", () => {
    expect(RIGHT_WORKSPACE_MAIN_CONTENT_WIDTH_PX).toBe(43.2 * 16 + 32);
    expect(getRightWorkspaceMaxWidth(1600)).toBe(1600 - RIGHT_WORKSPACE_MAIN_CONTENT_WIDTH_PX);
  });

  it("never shrinks below the minimum detail panel width", () => {
    expect(getRightWorkspaceMaxWidth(700)).toBe(RIGHT_WORKSPACE_MIN_DETAIL_PANEL_WIDTH);
    expect(clampRightWorkspaceWidth(240, 700)).toBe(RIGHT_WORKSPACE_MIN_DETAIL_PANEL_WIDTH);
  });
});
