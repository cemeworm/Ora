import { createModeSpecFromPattern, MVP_MODE_RUNTIME_ATOMS } from "@ora/shared";
import { describe, expect, it } from "vitest";
import {
  buildModeFlowEdges,
  buildModeFlowNodes,
  MODE_CAPABILITY_TARGET_HANDLE_ID,
  modeCapabilitySourceHandlePositions,
} from "./modeCanvas";

describe("mode canvas layout", () => {
  it("keeps Message Bus capability nodes separated from each other and the stage row", () => {
    const mode = createModeSpecFromPattern("message_bus");
    const runtimeAtoms = MVP_MODE_RUNTIME_ATOMS
      .filter((atom) => atom.scope === "mode" && atom.compatibleFamilies.includes("message_bus"))
      .map((atom) => atom.id);
    const nodes = buildModeFlowNodes({ ...mode, runtimeAtoms }, MVP_MODE_RUNTIME_ATOMS, 640);
    const boxes = nodes.map((node) => {
      const size = nodeSize(node.data.kind);
      return {
        id: node.id,
        left: node.position.x,
        top: node.position.y,
        right: node.position.x + size.width,
        bottom: node.position.y + size.height,
      };
    });

    for (const [index, box] of boxes.entries()) {
      for (const other of boxes.slice(index + 1)) {
        expect(overlaps(box, other), `${box.id} overlaps ${other.id}`).toBe(false);
      }
    }
  });

  it("fans runtime capability edges out through distinct handles", () => {
    const mode = createModeSpecFromPattern("message_bus");
    const runtimeAtoms = MVP_MODE_RUNTIME_ATOMS
      .filter((atom) => atom.scope === "mode" && atom.compatibleFamilies.includes("message_bus"))
      .map((atom) => atom.id);
    const edges = buildModeFlowEdges({ ...mode, runtimeAtoms }, MVP_MODE_RUNTIME_ATOMS)
      .filter((edge) => edge.id.startsWith("synthetic:"));
    const sourceHandles = new Set(edges.map((edge) => edge.sourceHandle));

    expect(sourceHandles.size).toBe(edges.length);
    expect(edges.every((edge) => edge.type === "smoothstep")).toBe(true);
    expect(edges.every((edge) => edge.targetHandle === MODE_CAPABILITY_TARGET_HANDLE_ID)).toBe(true);
    expect(edges.every((edge) => edge.label === undefined)).toBe(true);
  });

  it("groups runtime capability source handles by capability columns", () => {
    const handles = modeCapabilitySourceHandlePositions(7, 2);
    const leftColumnHandles = handles.filter((_handle, index) => index % 2 === 0);
    const rightColumnHandles = handles.filter((_handle, index) => index % 2 === 1);

    expect(handles).toHaveLength(7);
    expect(Math.max(...leftColumnHandles.map((handle) => handle.leftPercent))).toBeLessThan(
      Math.min(...rightColumnHandles.map((handle) => handle.leftPercent)),
    );
  });
});

function nodeSize(kind: "runtime-anchor" | "stage" | "mode-capability" | "node-attachment") {
  switch (kind) {
    case "runtime-anchor":
      return { width: 248, height: 120 };
    case "stage":
      return { width: 248, height: 152 };
    case "node-attachment":
      return { width: 184, height: 118 };
    default:
      return { width: 204, height: 126 };
  }
}

function overlaps(
  left: { left: number; top: number; right: number; bottom: number },
  right: { left: number; top: number; right: number; bottom: number },
) {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top;
}
