import type { SkillDescriptor } from "@cemeworm/shared";

const TOOL_MENTION_SIGIL = "$";

const COMMON_ENV_VARS = new Set([
  "PATH", "HOME", "USER", "SHELL", "PWD",
  "TMPDIR", "TEMP", "TMP", "LANG", "TERM",
  "XDG_CONFIG_HOME",
]);

/**
 * Extract $skill-name mentions from user input text.
 * Returns deduplicated skill names that the user explicitly requested.
 */
export function extractSkillMentions(text: string): string[] {
  const mentions = new Set<string>();
  const textBytes = new TextEncoder().encode(text);

  let index = 0;
  while (index < textBytes.length) {
    if (textBytes[index] !== TOOL_MENTION_SIGIL.charCodeAt(0)) {
      index++;
      continue;
    }

    const nameStart = index + 1;
    if (nameStart >= textBytes.length) {
      index++;
      continue;
    }

    const firstByte = textBytes[nameStart];
    if (!isMentionNameChar(firstByte)) {
      index++;
      continue;
    }

    let nameEnd = nameStart + 1;
    while (nameEnd < textBytes.length && isMentionNameChar(textBytes[nameEnd])) {
      nameEnd++;
    }

    const name = text.slice(nameStart, nameEnd);
    if (!COMMON_ENV_VARS.has(name.toUpperCase())) {
      mentions.add(name);
    }
    index = nameEnd;
  }

  return [...mentions];
}

/**
 * Match extracted $mentions against the skill registry.
 * Returns skill IDs that match, resolving name->id by case-insensitive lookup.
 */
export function resolveSkillMentions(
  mentions: string[],
  skills: readonly SkillDescriptor[],
): string[] {
  if (mentions.length === 0 || skills.length === 0) {
    return [];
  }

  const skillByName = new Map<string, SkillDescriptor>();
  const nameCounts = new Map<string, number>();

  for (const skill of skills) {
    const lower = skill.name.toLowerCase();
    skillByName.set(lower, skill);
    nameCounts.set(lower, (nameCounts.get(lower) ?? 0) + 1);
  }

  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const mention of mentions) {
    const lower = mention.toLowerCase();
    const skill = skillByName.get(lower);
    if (!skill || seen.has(skill.id)) {
      continue;
    }
    // Only resolve unambiguous names
    if ((nameCounts.get(lower) ?? 0) > 1) {
      continue;
    }
    seen.add(skill.id);
    resolved.push(skill.id);
  }

  return resolved;
}

function isMentionNameChar(byte: number): boolean {
  return (
    (byte >= 0x61 && byte <= 0x7a) || // a-z
    (byte >= 0x41 && byte <= 0x5a) || // A-Z
    (byte >= 0x30 && byte <= 0x39) || // 0-9
    byte === 0x5f || // _
    byte === 0x2d // -
  );
}
