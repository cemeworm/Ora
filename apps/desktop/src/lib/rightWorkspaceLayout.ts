import { CHAT_SURFACE_FRAME_WIDTH_REM } from "../components/chatSurfaceLayout";

export const RIGHT_WORKSPACE_MIN_DETAIL_PANEL_WIDTH = 360;
export const RIGHT_WORKSPACE_MAIN_CONTENT_BUFFER_REM = 2;
export const RIGHT_WORKSPACE_MAIN_CONTENT_WIDTH_PX =
  (CHAT_SURFACE_FRAME_WIDTH_REM + RIGHT_WORKSPACE_MAIN_CONTENT_BUFFER_REM) * 16;

export function getRightWorkspaceMaxWidth(
  containerWidthPx: number | null | undefined,
): number | undefined {
  if (typeof containerWidthPx !== "number" || !Number.isFinite(containerWidthPx)) {
    return undefined;
  }

  return Math.max(
    RIGHT_WORKSPACE_MIN_DETAIL_PANEL_WIDTH,
    containerWidthPx - RIGHT_WORKSPACE_MAIN_CONTENT_WIDTH_PX,
  );
}

export function clampRightWorkspaceWidth(
  widthPx: number,
  containerWidthPx: number | null | undefined,
): number {
  const maxWidth = getRightWorkspaceMaxWidth(containerWidthPx);
  return Math.min(
    Math.max(widthPx, RIGHT_WORKSPACE_MIN_DETAIL_PANEL_WIDTH),
    maxWidth ?? Number.POSITIVE_INFINITY,
  );
}
