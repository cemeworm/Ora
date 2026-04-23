import { SendHorizontal, Square } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";

interface ChatInputProps {
  composerPrompt: string;
  isLoading: boolean;
  isRunning: boolean;
  onPromptChange: (prompt: string) => void;
  onStartRun: () => void;
}

export function ChatInput({
  composerPrompt,
  isLoading,
  isRunning,
  onPromptChange,
  onStartRun,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (composerPrompt.trim() && !isLoading) {
        onStartRun();
      }
    }
  }

  return (
    <div className="border-t border-bench-200 bg-bench-50 px-5 py-3">
      <div className="flex items-end gap-2 rounded-lg border border-bench-200 bg-white p-2 shadow-sm ring-1 ring-inset ring-bench-200 focus-within:ring-bench-900">
        <textarea
          ref={textareaRef}
          value={composerPrompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isRunning ? "Run in progress..." : "Send a message to start an agent run..."}
          disabled={isLoading}
          rows={1}
          className="min-h-[36px] max-h-[120px] min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-bench-300 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ height: "auto", overflow: "hidden" }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = "auto";
            target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
          }}
        />
        <button
          onClick={onStartRun}
          disabled={!composerPrompt.trim() || isLoading}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bench-900 text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          title={isLoading ? "Starting..." : "Send message"}
        >
          {isLoading ? (
            <Square size={14} />
          ) : (
            <SendHorizontal size={14} />
          )}
        </button>
      </div>
      <p className="mt-1.5 text-center text-[11px] text-bench-300">
        Press Enter to send, Shift+Enter for new line
      </p>
    </div>
  );
}
