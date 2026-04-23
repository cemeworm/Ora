import type { HTMLAttributes, ReactNode } from "react";

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  if (typeof children === "string") {
    return <span title={String(content)}>{children}</span>;
  }
  return <span title={typeof content === "string" ? content : undefined}>{children}</span>;
}

export function TooltipContent(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}

export function TooltipTrigger({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
