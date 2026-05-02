import { Pencil } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils";

// ── Preset topology definitions ──────────────────────────

interface TopologyNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

interface TopologyEdge {
  from: string;
  to: string;
}

interface PresetTopology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

const presets = {
  generator_verifier: {
    label: "生成-验证",
    topology: {
      nodes: [
        { id: "gen", label: "Generator", x: 120, y: 90 },
        { id: "ver", label: "Verifier", x: 340, y: 90 },
      ],
      edges: [{ from: "gen", to: "ver" }],
    } satisfies PresetTopology,
  },
  orchestrator_subagent: {
    label: "编排调度",
    topology: {
      nodes: [
        { id: "orch", label: "Orchestrator", x: 230, y: 40 },
        { id: "res", label: "Researcher", x: 80, y: 150 },
        { id: "bld", label: "Builder", x: 230, y: 150 },
        { id: "rev", label: "Reviewer", x: 380, y: 150 },
      ],
      edges: [
        { from: "orch", to: "res" },
        { from: "orch", to: "bld" },
        { from: "orch", to: "rev" },
      ],
    } satisfies PresetTopology,
  },
  agent_teams: {
    label: "团队协作",
    topology: {
      nodes: [
        { id: "tri", label: "Triage", x: 80, y: 90 },
        { id: "bld", label: "Builder", x: 230, y: 40 },
        { id: "rev", label: "Reviewer", x: 380, y: 90 },
      ],
      edges: [
        { from: "tri", to: "bld" },
        { from: "bld", to: "rev" },
        { from: "tri", to: "rev" },
      ],
    } satisfies PresetTopology,
  },
} as const;

type PresetKey = keyof typeof presets;

const customPillLabel = "自己设计";

// ── SVG rendering helpers ────────────────────────────────

function getNodeCenter(node: TopologyNode) {
  return { cx: node.x + 52, cy: node.y + 22 };
}

function TopologySVG({ topology }: { topology: PresetTopology }) {
  return (
    <svg
      viewBox="0 0 480 200"
      className="h-full w-full"
      fill="none"
      aria-hidden="true"
    >
      {/* Edges */}
      {topology.edges.map((edge) => {
        const fromNode = topology.nodes.find((n) => n.id === edge.from)!;
        const toNode = topology.nodes.find((n) => n.id === edge.to)!;
        const from = getNodeCenter(fromNode);
        const to = getNodeCenter(toNode);
        return (
          <line
            key={`${edge.from}-${edge.to}`}
            x1={from.cx}
            y1={from.cy}
            x2={to.cx}
            y2={to.cy}
            stroke="#b99363"
            strokeWidth="2"
            strokeLinecap="round"
            className="animate-draw-line"
          />
        );
      })}
      {/* Nodes */}
      {topology.nodes.map((node, i) => {
        const center = getNodeCenter(node);
        return (
          <g
            key={node.id}
            className="animate-node-pop"
            style={{ animationDelay: `${300 + i * 150}ms` }}
          >
            <rect
              x={node.x}
              y={node.y}
              width={104}
              height={44}
              rx={12}
              fill="#fff7ea"
              stroke="#decbb0"
              strokeWidth="1.5"
            />
            <text
              x={center.cx}
              y={center.cy + 1}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-bench-900 text-[13px] font-semibold"
              style={{ fontFamily: "inherit" }}
            >
              {node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function CustomCanvas() {
  const templateNodes = [
    { id: "tmpl-res", label: "Researcher", x: 60, y: 50 },
    { id: "tmpl-bld", label: "Builder", x: 60, y: 115 },
    { id: "tmpl-rev", label: "Reviewer", x: 60, y: 180 },
  ];

  return (
    <svg
      viewBox="0 0 480 240"
      className="h-full w-full"
      fill="none"
      aria-hidden="true"
    >
      {/* Dashed canvas border */}
      <rect
        x={140}
        y={20}
        width={310}
        height={200}
        rx={16}
        stroke="#d6c4a8"
        strokeWidth="1.5"
        strokeDasharray="8 6"
        fill="transparent"
      />

      {/* Plus node button */}
      <g className="animate-node-pop" style={{ animationDelay: "200ms" }}>
        <circle
          cx={295}
          cy={120}
          r={24}
          fill="#efe0ca"
          stroke="#d6c4a8"
          strokeWidth="1.5"
        />
        <text
          x={295}
          y={121}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-bench-600 text-xl"
        >
          +
        </text>
      </g>

      {/* Template nodes on the left side */}
      {templateNodes.map((node, i) => (
        <g
          key={node.id}
          className="animate-node-pop"
          style={{ animationDelay: `${400 + i * 150}ms` }}
        >
          <rect
            x={node.x}
            y={node.y}
            width={100}
            height={38}
            rx={10}
            fill="#f8efe2"
            stroke="#d6c4a8"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity={0.6}
          />
          <text
            x={node.x + 50}
            y={node.y + 19}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-bench-500 text-[12px]"
            style={{ fontFamily: "inherit" }}
          >
            {node.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ── Main component ───────────────────────────────────────

export function CapabilitiesShowcaseStep() {
  const [activePreset, setActivePreset] = useState<PresetKey | "custom">(
    "generator_verifier",
  );

  const isCustom = activePreset === "custom";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center gap-8 py-6">
      {/* Title */}
      <div className="animate-fade-in text-center" style={{ animationDelay: "120ms" }}>
        <h2 className="text-2xl font-semibold leading-snug tracking-tight text-bench-900 sm:text-3xl">
          同一个任务，不同的跑法
          <span className="block font-serif italic text-bench-600">
            ——或者，你自己来画。
          </span>
        </h2>
      </div>

      {/* Pill buttons */}
      <div
        className="animate-fade-in flex flex-wrap justify-center gap-2"
        style={{ animationDelay: "320ms" }}
      >
        {(Object.keys(presets) as PresetKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setActivePreset(key)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm font-medium transition-all duration-200",
              activePreset === key
                ? "border-bench-400 bg-bench-900 text-white shadow-sm"
                : "border-bench-200 bg-white/60 text-bench-700 hover:bg-white",
            )}
          >
            {presets[key].label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setActivePreset("custom")}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium transition-all duration-200",
            isCustom
              ? "border-bench-400 bg-bench-900 text-white shadow-sm"
              : "border-bench-200 bg-white/60 text-bench-700 hover:bg-white",
          )}
        >
          <Pencil size={13} />
          {customPillLabel}
        </button>
      </div>

      {/* Topology card */}
      <div
        className="animate-fade-in w-full"
        style={{ animationDelay: "520ms" }}
      >
        <div className="animate-paper-float relative overflow-hidden rounded-[28px] border border-[#d6c4a8] bg-[#f8efe2] p-5 shadow-[0_16px_48px_rgba(77,58,34,0.12)] sm:p-7">
          <div
            className="absolute inset-0 opacity-45"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(89, 70, 44, 0.16) 1px, transparent 0)",
              backgroundSize: "22px 22px",
            }}
          />
          <div className="relative rounded-[22px] border border-[#d9c8ad] bg-[#fffaf1]/90 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] sm:p-6">
            <div className="min-h-[200px] sm:min-h-[240px]">
              {isCustom ? (
                <CustomCanvas />
              ) : (
                <TopologySVG topology={presets[activePreset].topology} />
              )}
            </div>

            {isCustom && (
              <p className="animate-fade-in mt-4 text-center text-sm leading-6 text-bench-600">
                在 Ora 中，你可以自由定义节点、连线、每个智能体的工具和技能。
                <br />
                这是你的编排，你说了算。
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
