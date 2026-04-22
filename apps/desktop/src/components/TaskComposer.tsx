import { FileText, Play } from "lucide-react";
import type { CoordinationPattern } from "../types";

interface TaskComposerProps {
  prompt: string;
  selectedPattern: CoordinationPattern;
  isLoading: boolean;
  onPromptChange: (text: string) => void;
  onStartRun: () => void;
}

export function TaskComposer({
  prompt,
  selectedPattern,
  isLoading,
  onPromptChange,
  onStartRun,
}: TaskComposerProps) {
  const canStart = prompt.trim().length > 0 && !isLoading;

  return (
    <div className="rounded-lg bg-white p-3 shadow-pane ring-1 ring-inset ring-bench-200">
      <div className="flex items-start gap-3">
        <div className="mt-1 rounded-md bg-bench-100 p-2 text-bench-700">
          <FileText size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <label htmlFor="task-composer" className="text-xs font-semibold text-bench-700">
            Task composer
          </label>
          <textarea
            id="task-composer"
            className="mt-1 min-h-[66px] w-full resize-none border-0 bg-transparent text-sm leading-6 outline-none placeholder:text-bench-700"
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="rounded-full bg-bench-100 px-2 py-0.5 text-[11px] font-semibold text-bench-700">
          {selectedPattern.replace(/_/g, " ")}
        </span>
        <button
          onClick={onStartRun}
          disabled={!canStart}
          className="inline-flex items-center gap-2 rounded-md bg-bench-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-pane active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Play size={16} />
          {isLoading ? "Starting" : "Start run"}
        </button>
      </div>
    </div>
  );
}
