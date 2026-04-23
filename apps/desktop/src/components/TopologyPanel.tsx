import { useState } from "react";
import { ChevronDown, ChevronRight, Network } from "lucide-react";
import type { TopologyEdge, TopologyNode } from "../types";

const nodeTone: Record<TopologyNode["status"], string> = {
  active: "border-signal-acid bg-lime-50 shadow-[0_0_0_3px_rgba(155,216,46,0.16)]",
  idle: "border-bench-200 bg-white",
  blocked: "border-signal-amber bg-amber-50 shadow-[0_0_0_3px_rgba(215,153,33,0.14)]",
  done: "border-emerald-200 bg-emerald-50",
};

interface TopologyPanelProps {
  topologyNodes: TopologyNode[];
  topologyEdges: TopologyEdge[];
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
}

export function TopologyPanel({
  topologyNodes,
  topologyEdges,
  selectedNodeId,
  onSelectNode,
}: TopologyPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center gap-2 rounded-md border border-bench-200 bg-white px-3 py-1.5 text-xs font-medium shadow-sm transition hover:shadow-pane active:scale-95"
      >
        <Network size={14} />
        Show topology
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-bench-200 bg-white shadow-sm">
      <button
        onClick={() => setExpanded(false)}
        className="flex w-full items-center justify-between px-4 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <Network size={14} className="text-bench-700" />
          <span className="text-xs font-semibold">Topology</span>
        </div>
        <ChevronDown size={14} className="text-bench-700" />
      </button>
      <div className="relative h-[200px] overflow-hidden rounded-b-lg bg-bench-50 ring-1 ring-inset ring-bench-200">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 780 200" aria-hidden="true">
          {topologyEdges.map((edge) => {
            const from = topologyNodes.find((n) => n.id === edge.from);
            const to = topologyNodes.find((n) => n.id === edge.to);
            if (!from || !to) return null;
            return (
              <g key={`${edge.from}-${edge.to}`}>
                <line x1={from.x + 58} y1={from.y + 28} x2={to.x + 58} y2={to.y + 28} stroke="#d2d2c7" strokeWidth="2" />
                <text x={(from.x + to.x) / 2 + 58} y={(from.y + to.y) / 2 + 22} textAnchor="middle" className="fill-bench-700 text-[11px]">
                  {edge.label}
                </text>
              </g>
            );
          })}
        </svg>
        {topologyNodes.map((node) => (
          <button
            key={node.id}
            onClick={() => onSelectNode(node.id)}
            className={`absolute w-[124px] rounded-md border p-2 text-left transition duration-150 hover:shadow-lift active:scale-[0.98] ${
              nodeTone[node.status]
            } ${selectedNodeId === node.id ? "outline outline-2 outline-offset-2 outline-bench-900" : ""}`}
            style={{ left: node.x, top: node.y }}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${node.status === "active" ? "bg-signal-acid" : "bg-bench-300"}`} />
              <span className="truncate text-xs font-semibold">{node.label}</span>
            </div>
            <p className="mt-1 truncate text-[11px] text-bench-700">{node.role}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
