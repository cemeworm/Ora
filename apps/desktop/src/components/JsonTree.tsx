import { useState } from "react";

interface JsonTreeProps {
  data: unknown;
  depth?: number;
  defaultExpanded?: number;
}

export function JsonTree({ data, depth = 0, defaultExpanded = 2 }: JsonTreeProps) {
  if (data === null || data === undefined) {
    return <span className="font-mono text-xs text-bench-700">null</span>;
  }

  if (typeof data === "boolean") {
    return <span className="font-mono text-xs text-amber-700">{String(data)}</span>;
  }

  if (typeof data === "number") {
    return <span className="font-mono text-xs text-blue-700">{data}</span>;
  }

  if (typeof data === "string") {
    return <span className="font-mono text-xs text-emerald-700">"{data}"</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span className="font-mono text-xs text-bench-700">[]</span>;
    }
    return <JsonArray data={data} depth={depth} defaultExpanded={defaultExpanded} />;
  }

  if (typeof data === "object") {
    return <JsonObject data={data as Record<string, unknown>} depth={depth} defaultExpanded={defaultExpanded} />;
  }

  return <span className="font-mono text-xs text-bench-700">{String(data)}</span>;
}

function JsonObject({
  data,
  depth,
  defaultExpanded,
}: {
  data: Record<string, unknown>;
  depth: number;
  defaultExpanded: number;
}) {
  const [expanded, setExpanded] = useState(depth < defaultExpanded);
  const keys = Object.keys(data);

  if (keys.length === 0) {
    return <span className="font-mono text-xs text-bench-700">{"{}"}</span>;
  }

  return (
    <div>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="inline-flex items-center gap-1 font-mono text-xs text-bench-900 hover:text-bench-700"
      >
        <span className="text-bench-700">{expanded ? "\u25BC" : "\u25B6"}</span>
        {"{"}
        {!expanded && <span className="text-bench-700">{keys.length} keys</span>}
      </button>
      {expanded && (
        <div className="ml-4">
          {keys.map((key) => (
            <div key={key}>
              <span className="font-mono text-xs text-bench-900">{key}</span>
              <span className="font-mono text-xs text-bench-700">: </span>
              <JsonTree data={data[key]} depth={depth + 1} defaultExpanded={defaultExpanded} />
            </div>
          ))}
        </div>
      )}
      {expanded && <span className="font-mono text-xs text-bench-700">{"}"}</span>}
      {!expanded && <span className="font-mono text-xs text-bench-700">{"}"}</span>}
    </div>
  );
}

function JsonArray({ data, depth, defaultExpanded }: { data: unknown[]; depth: number; defaultExpanded: number }) {
  const [expanded, setExpanded] = useState(depth < defaultExpanded);

  return (
    <div>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="inline-flex items-center gap-1 font-mono text-xs text-bench-900 hover:text-bench-700"
      >
        <span className="text-bench-700">{expanded ? "\u25BC" : "\u25B6"}</span>
        {"["}
        {!expanded && <span className="text-bench-700">{data.length} items</span>}
      </button>
      {expanded && (
        <div className="ml-4">
          {data.map((item, index) => (
            <div key={index}>
              <JsonTree data={item} depth={depth + 1} defaultExpanded={defaultExpanded} />
            </div>
          ))}
        </div>
      )}
      {expanded && <span className="font-mono text-xs text-bench-700">{"]"}</span>}
      {!expanded && <span className="font-mono text-xs text-bench-700">{"]"}</span>}
    </div>
  );
}
