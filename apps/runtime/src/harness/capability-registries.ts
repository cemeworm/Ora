import fs from "node:fs";
import path from "node:path";
import {
  MVP_SKILLS,
  MVP_TOOLS,
  SkillDescriptorSchema,
  SkillRegistrySchema,
  ToolRegistrySchema,
  type CoordinationPattern,
  type SkillDescriptor,
  type SkillRegistry,
  type ToolDescriptor,
  type ToolRegistry,
} from "@ora/shared";

function repoRoot(): string {
  return path.resolve(process.cwd());
}

function skillsRoot(): string {
  return path.join(repoRoot(), "skills");
}

function parseSkillFile(skillPath: string): SkillDescriptor | undefined {
  const raw = fs.readFileSync(skillPath, "utf8");
  const nameMatch = raw.match(/^name:\s*(.+)$/m);
  const descriptionMatch = raw.match(/^description:\s*(.+)$/m);
  const name = nameMatch?.[1]?.trim().replace(/^["']|["']$/g, "");
  const description = descriptionMatch?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!name || !description) {
    return undefined;
  }

  return SkillDescriptorSchema.parse({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    description,
    path: path.relative(repoRoot(), skillPath),
    promptSnippet: description,
    allowedPatterns: [],
    tags: [],
  });
}

function scanSkillFiles(root: string): SkillDescriptor[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const descriptors: SkillDescriptor[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        const parsed = parseSkillFile(fullPath);
        if (parsed) {
          descriptors.push(parsed);
        }
      }
    }
  }

  return descriptors.sort((a, b) => a.name.localeCompare(b.name));
}

export class RuntimeToolRegistry {
  constructor(private readonly tools: readonly ToolDescriptor[] = MVP_TOOLS) {}

  list(): ToolDescriptor[] {
    return ToolRegistrySchema.parse({
      tools: [...this.tools],
      defaultPolicyId: "runtime.default_policy",
    }).tools;
  }

  snapshot(): ToolRegistry {
    return ToolRegistrySchema.parse({
      tools: this.list(),
      defaultPolicyId: "runtime.default_policy",
    });
  }
}

export class RuntimeSkillRegistry {
  constructor(
    private readonly skills: readonly SkillDescriptor[] = loadRuntimeSkills()
  ) {}

  list(pattern?: CoordinationPattern): SkillDescriptor[] {
    const selected = pattern
      ? this.skills.filter(
          (skill) => skill.allowedPatterns.length === 0 || skill.allowedPatterns.includes(pattern)
        )
      : [...this.skills];

    return selected.map((skill) => SkillDescriptorSchema.parse(skill));
  }

  snapshot(pattern?: CoordinationPattern): SkillRegistry {
    return SkillRegistrySchema.parse({
      skills: this.list(pattern),
    });
  }

  promptSnippets(skillIds: string[]): string[] {
    const wanted = new Set(skillIds);
    return this.skills
      .filter((skill) => wanted.has(skill.id) || wanted.has(skill.name))
      .map((skill) => skill.promptSnippet)
      .filter((snippet): snippet is string => typeof snippet === "string" && snippet.length > 0);
  }
}

export function loadRuntimeSkills(): SkillDescriptor[] {
  const scanned = scanSkillFiles(skillsRoot());
  if (scanned.length === 0) {
    return [...MVP_SKILLS];
  }

  const merged = new Map<string, SkillDescriptor>();
  for (const skill of MVP_SKILLS) {
    merged.set(skill.id, skill);
  }
  for (const skill of scanned) {
    merged.set(skill.id, {
      ...merged.get(skill.id),
      ...skill,
    });
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}
