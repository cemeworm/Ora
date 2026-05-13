import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CODE_DEVELOPMENT_MODE_ID, ORA_ROOT_AGENT_ID } from "@cemeworm/shared";
import { describe, expect, it } from "vitest";
import { LocalRunStore } from "../src/index.js";

function freshStoreDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-modes-"));
}

describe("runtime built-in modes", () => {
  it("lists and returns the Code Development system preset", () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir() });

    const listed = store.listModes().find((mode) => mode.id === CODE_DEVELOPMENT_MODE_ID);
    const fetched = store.getMode({ modeId: CODE_DEVELOPMENT_MODE_ID });

    expect(listed).toBeDefined();
    expect(fetched.id).toBe(CODE_DEVELOPMENT_MODE_ID);
    expect(fetched.systemPreset).toBe(true);
    expect(fetched.visibility).toBe("user");
    expect(fetched.family).toBe("agent_teams");
    expect(fetched.profiles.map((profile) => profile.id)).toEqual([
      ORA_ROOT_AGENT_ID,
      "builder",
      "reviewer",
      "debugger",
    ]);
    expect(fetched.nodes.map((node) => node.id)).toEqual([
      "triage",
      "build",
      "review",
      "debug",
      "handoff",
    ]);
  });

  it("keeps the Code Development system preset read-only", () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir() });
    const mode = store.getMode({ modeId: CODE_DEVELOPMENT_MODE_ID });

    expect(() => store.updateMode({
      modeId: CODE_DEVELOPMENT_MODE_ID,
      spec: {
        ...mode,
        label: "Edited Code Development",
      },
    })).toThrow(/read-only/i);
    expect(() => store.deleteMode({ modeId: CODE_DEVELOPMENT_MODE_ID })).toThrow(/cannot be deleted/i);
  });
});
