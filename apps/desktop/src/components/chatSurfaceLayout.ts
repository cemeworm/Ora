export const CHAT_SURFACE_FRAME_WIDTH_REM = 43.2;
export const CHAT_SURFACE_MIN_CONTENT_EXTRA_WIDTH_REM = 2;
export const CHAT_SURFACE_FRAME_WIDTH_CLASS = "w-full max-w-[43.2rem]";
export const CHAT_SURFACE_VIEWPORT_GUTTER_CLASS =
  "w-full px-4 md:px-6 xl:px-8";
// Keep the message rail on the same geometric center as the composer by
// reserving symmetric outer inset instead of only pushing away from the right.
export const CHAT_SURFACE_SCROLLBAR_COMPENSATION_CLASS =
  "lg:px-4 xl:px-6";
// Absolute overlays cannot reuse the negative margin above. Use symmetric
// horizontal inset instead so the composer stays on the same geometric center.
export const CHAT_SURFACE_OVERLAY_SCROLLBAR_PADDING_CLASS =
  "lg:px-4 xl:px-6";
