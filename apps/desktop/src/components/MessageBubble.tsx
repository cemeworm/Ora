import type { ChatMessage } from "../types";

interface MessageBubbleProps {
  role: ChatMessage["role"];
  content: string;
  timestamp: string;
}

export function MessageBubble({ role, content, timestamp }: MessageBubbleProps) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[70%] rounded-2xl rounded-br-sm bg-bench-900 px-4 py-2.5 text-bench-50 shadow-sm">
          <p className="text-sm leading-6 whitespace-pre-wrap">{content}</p>
          <p className="mt-1 text-right text-[11px] text-bench-300">{timestamp}</p>
        </div>
      </div>
    );
  }

  if (role === "assistant") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[70%] rounded-2xl rounded-bl-sm bg-bench-100 px-4 py-2.5 ring-1 ring-inset ring-bench-200">
          <p className="text-sm leading-6 whitespace-pre-wrap">{content}</p>
          <p className="mt-1 text-[11px] text-bench-700">{timestamp}</p>
        </div>
      </div>
    );
  }

  // system messages - centered, muted
  return (
    <div className="flex justify-center">
      <div className="max-w-[80%] rounded-full bg-bench-100 px-4 py-1.5 text-center ring-1 ring-inset ring-bench-200">
        <p className="text-xs text-bench-700">{content}</p>
      </div>
    </div>
  );
}
