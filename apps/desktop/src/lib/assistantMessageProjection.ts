export interface AssistantMessageTextProjection {
  text: string;
}

export function mergeAssistantMessageTextProjection(
  current: AssistantMessageTextProjection | undefined,
  payload: Record<string, unknown>,
): AssistantMessageTextProjection | undefined {
  const currentText = current?.text ?? "";
  const delta = typeof payload.delta === "string" ? payload.delta : undefined;
  if (delta) {
    return { text: `${currentText}${delta}` };
  }

  const content = typeof payload.content === "string" ? payload.content : undefined;
  if (!content) {
    return current;
  }
  if (!currentText || content.startsWith(currentText)) {
    return { text: content };
  }
  if (content === currentText || currentText.endsWith(content)) {
    return current;
  }
  return { text: `${currentText}${content}` };
}
