import { Eye, FileCode2, FileText, Pencil, Plus, RefreshCcw, Save, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useWorkbenchDispatch } from "../lib/state";
import type { OraSkillDetail, OraSkillPackageFileContent, OraSkillRegistry, RuntimeClient } from "../lib/runtimeClient";
import { cn } from "../lib/utils";
import { PageHeader } from "./PageHeader";
import { Button } from "./ui/button";
import { Select } from "./ui/select";

type SkillMode = "gallery" | "create" | "edit";
type CategoryFilter = "all" | "public" | "private";
type EnabledFilter = "all" | "enabled" | "disabled";
type SkillPackageFileEntry = NonNullable<OraSkillDetail["files"]>[number];

interface FileDrawerState {
  mode: "existing" | "new";
  path: string;
  draftPath: string;
  content: string;
  draftContent: string;
  executable: boolean;
  kind?: SkillPackageFileEntry["kind"];
  loading: boolean;
  busy: boolean;
  error: string;
}

const EMPTY_DETAIL: OraSkillDetail = {
  id: "",
  name: "",
  description: "",
  category: "private",
  enabled: true,
  editable: true,
  allowedPatterns: [],
  tags: [],
  files: [],
  content: "",
};

function syncSkillContentMetadata(content: string, name: string, description: string): string {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) {
    return content;
  }

  const frontmatter = upsertFrontmatterValue(
    upsertFrontmatterValue(match[1] ?? "", "name", name),
    "description",
    description,
  );
  return content.replace(match[0], `---\n${frontmatter}\n---\n`);
}

function upsertFrontmatterValue(frontmatter: string, key: "name" | "description", value: string): string {
  const nextLine = `${key}: ${formatFrontmatterValue(value)}`;
  const lines = frontmatter.split(/\r?\n/);
  const nextLines: string[] = [];
  let replaced = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.match(new RegExp(`^${key}:\\s*`))) {
      nextLines.push(nextLine);
      replaced = true;
      while (index + 1 < lines.length && !/^[A-Za-z0-9_-]+:\s*/.test(lines[index + 1]!)) {
        index += 1;
      }
      continue;
    }
    nextLines.push(line);
  }

  if (!replaced) {
    if (key === "description") {
      const nameIndex = nextLines.findIndex((line) => /^name:\s*/.test(line));
      nextLines.splice(nameIndex >= 0 ? nameIndex + 1 : 0, 0, nextLine);
    } else {
      nextLines.unshift(nextLine);
    }
  }

  return nextLines.join("\n").replace(/\n+$/, "");
}

function formatFrontmatterValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function SkillsView({ runtimeClient }: { runtimeClient: RuntimeClient }) {
  const dispatch = useWorkbenchDispatch();
  const [registry, setRegistry] = useState<OraSkillRegistry>({ skills: [] });
  const [selectedSkill, setSelectedSkill] = useState<OraSkillDetail | undefined>();
  const [mode, setMode] = useState<SkillMode>("gallery");
  const [draft, setDraft] = useState<OraSkillDetail>(EMPTY_DETAIL);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>("all");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [fileDrawer, setFileDrawer] = useState<FileDrawerState | undefined>();

  const visibleSkills = useMemo(() => {
    return registry.skills.filter((skill) => {
      if (enabledFilter === "enabled" && !skill.enabled) return false;
      if (enabledFilter === "disabled" && skill.enabled) return false;
      return true;
    });
  }, [enabledFilter, registry.skills]);

  async function loadSkills(nextQuery = query, nextCategory = category, activeName = selectedSkill?.name) {
    setBusy("refresh");
    setError("");
    try {
      const nextRegistry = await runtimeClient.listSkills({
        query: nextQuery.trim() || undefined,
        category: nextCategory === "all" ? undefined : nextCategory,
      });
      setRegistry(nextRegistry);
      dispatch({ type: "SET_SKILL_REGISTRY", skillRegistry: nextRegistry });
      if (activeName && !nextRegistry.skills.some((skill) => skill.name === activeName)) {
        setSelectedSkill(undefined);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load skills.");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    void loadSkills().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to load skills.");
    });
  }, [runtimeClient]);

  async function selectSkill(name: string) {
    setBusy(`select:${name}`);
    setError("");
    try {
      const detail = await runtimeClient.getSkill(name);
      setSelectedSkill(detail);
      setDraft(detail);
      setMode("gallery");
      setFileDrawer(undefined);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load skill.");
    } finally {
      setBusy("");
    }
  }

  function startCreate() {
    const nextDraft = {
      ...EMPTY_DETAIL,
      content: "",
    };
    setDraft(nextDraft);
    setSelectedSkill(undefined);
    setMode("create");
    setError("");
    setFileDrawer(undefined);
  }

  function startEdit() {
    if (!selectedSkill?.editable) return;
    setDraft(selectedSkill);
    setMode("edit");
    setError("");
    setFileDrawer(undefined);
  }

  function cancelDraft() {
    setMode("gallery");
    setDraft(selectedSkill ?? EMPTY_DETAIL);
    setError("");
  }

  async function saveSkill() {
    const name = draft.name.trim().toLowerCase();
    if (!name) {
      setError("Skill name is required.");
      return;
    }

    const content = syncSkillContentMetadata(draft.content, name, draft.description);
    setBusy(mode === "create" ? "create" : "save");
    setError("");
    try {
      const saved = mode === "create"
        ? await runtimeClient.createSkill({
          name,
          description: draft.description,
          content: content.trim() || undefined,
          enabled: draft.enabled,
        })
        : await runtimeClient.updateSkill({
          name: selectedSkill?.name ?? name,
          nextName: name,
          content,
        });
      const detail = mode === "edit" && saved.enabled !== draft.enabled
        ? await runtimeClient.setSkillEnabled({ name: saved.name, enabled: draft.enabled })
        : saved;
      setSelectedSkill(detail);
      setDraft(detail);
      setMode("gallery");
      await loadSkills(query, category, detail.name);
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `${detail.name} skill saved.` });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save skill.");
    } finally {
      setBusy("");
    }
  }

  async function toggleSkill(skill: OraSkillDetail | { name: string; enabled: boolean }) {
    setBusy(`toggle:${skill.name}`);
    setError("");
    try {
      const detail = await runtimeClient.setSkillEnabled({
        name: skill.name,
        enabled: !skill.enabled,
      });
      setSelectedSkill((current) => current?.name === detail.name ? detail : current);
      setDraft((current) => current.name === detail.name ? detail : current);
      await loadSkills();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to update skill state.");
    } finally {
      setBusy("");
    }
  }

  async function deleteSkill() {
    if (!selectedSkill?.editable || !window.confirm(`Delete ${selectedSkill.category} skill '${selectedSkill.name}'?`)) {
      return;
    }
    setBusy(`delete:${selectedSkill.name}`);
    setError("");
    try {
      await runtimeClient.deleteSkill(selectedSkill.name);
      setSelectedSkill(undefined);
      setDraft(EMPTY_DETAIL);
      setFileDrawer(undefined);
      setMode("gallery");
      await loadSkills();
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Deleted skill ${selectedSkill.name}.` });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to delete skill.");
    } finally {
      setBusy("");
    }
  }

  async function applyFilter(nextQuery = query, nextCategory = category) {
    setQuery(nextQuery);
    setCategory(nextCategory);
    await loadSkills(nextQuery, nextCategory);
  }

  function startNewPackageFile() {
    if (!selectedSkill) return;
    setFileDrawer({
      mode: "new",
      path: "",
      draftPath: "",
      content: "",
      draftContent: "",
      executable: false,
      loading: false,
      busy: false,
      error: "",
    });
  }

  async function openPackageFile(file: SkillPackageFileEntry) {
    if (!selectedSkill) return;
    setFileDrawer({
      mode: "existing",
      path: file.path,
      draftPath: file.path,
      content: "",
      draftContent: "",
      executable: file.executable,
      kind: file.kind,
      loading: true,
      busy: false,
      error: "",
    });
    try {
      const loaded = await runtimeClient.getSkillFile(selectedSkill.name, file.path);
      setFileDrawer((current) => current?.path === file.path
        ? fileContentToDrawer(loaded)
        : current);
    } catch (nextError) {
      setFileDrawer((current) => current?.path === file.path
        ? {
          ...current,
          loading: false,
          error: nextError instanceof Error ? nextError.message : "Failed to load package file.",
        }
        : current);
    }
  }

  function closePackageFile() {
    if (fileDrawer && fileDrawerChanged(fileDrawer) && !window.confirm("Discard unsaved package file changes?")) {
      return;
    }
    setFileDrawer(undefined);
  }

  async function savePackageFile() {
    if (!selectedSkill || !fileDrawer) return;
    const filePath = fileDrawer.draftPath.trim();
    if (!filePath) {
      setFileDrawer((current) => current ? { ...current, error: "File path is required." } : current);
      return;
    }
    setFileDrawer((current) => current ? { ...current, busy: true, error: "" } : current);
    try {
      const detail = await runtimeClient.upsertSkillFile({
        skillName: selectedSkill.name,
        path: filePath,
        content: fileDrawer.draftContent,
        executable: fileDrawer.executable,
      });
      setSelectedSkill(detail);
      setDraft((current) => current.name === detail.name ? detail : current);
      setFileDrawer({
        mode: "existing",
        path: filePath,
        draftPath: filePath,
        content: fileDrawer.draftContent,
        draftContent: fileDrawer.draftContent,
        executable: fileDrawer.executable,
        kind: detail.files?.find((file) => file.path === filePath)?.kind ?? fileDrawer.kind,
        loading: false,
        busy: false,
        error: "",
      });
      await loadSkills(query, category, detail.name);
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `${filePath} saved.` });
    } catch (nextError) {
      setFileDrawer((current) => current
        ? {
          ...current,
          busy: false,
          error: nextError instanceof Error ? nextError.message : "Failed to save package file.",
        }
        : current);
    }
  }

  async function deletePackageFile() {
    if (!selectedSkill || !fileDrawer || fileDrawer.mode !== "existing") return;
    if (!window.confirm(`Delete package file '${fileDrawer.path}'?`)) {
      return;
    }
    setFileDrawer((current) => current ? { ...current, busy: true, error: "" } : current);
    try {
      const detail = await runtimeClient.deleteSkillFile(selectedSkill.name, fileDrawer.path);
      setSelectedSkill(detail);
      setDraft((current) => current.name === detail.name ? detail : current);
      setFileDrawer(undefined);
      await loadSkills(query, category, detail.name);
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `${fileDrawer.path} deleted.` });
    } catch (nextError) {
      setFileDrawer((current) => current
        ? {
          ...current,
          busy: false,
          error: nextError instanceof Error ? nextError.message : "Failed to delete package file.",
        }
        : current);
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col bg-transparent">
      <PageHeader
        title="技能"
        actions={(
          <>
            <button
              onClick={() => void loadSkills()}
              disabled={busy.length > 0}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-4 text-sm font-semibold transition hover:bg-bench-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCcw size={16} className={cn(busy === "refresh" && "animate-spin")} />
              Refresh
            </button>
            <button
              onClick={startCreate}
              disabled={busy.length > 0}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={16} />
              New skill
            </button>
          </>
        )}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden border-b border-border bg-white/55 p-4 lg:border-b-0 lg:border-r">
          <div className="shrink-0 space-y-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bench-500" size={14} />
              <input
                value={query}
                onChange={(event) => void applyFilter(event.target.value, category)}
                placeholder="Search skills"
                className="h-10 w-full rounded-md border border-bench-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-bench-900"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Select
                aria-label="Skill source filter"
                value={category}
                onChange={(event) => void applyFilter(query, event.target.value as CategoryFilter)}
                className="h-9 text-xs font-semibold"
              >
                <option value="all">All sources</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
              </Select>
              <Select
                aria-label="Skill state filter"
                value={enabledFilter}
                onChange={(event) => setEnabledFilter(event.target.value as EnabledFilter)}
                className="h-9 text-xs font-semibold"
              >
                <option value="all">All states</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </Select>
            </div>
          </div>

          {error && (
            <div className="mt-4 shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
              {error}
            </div>
          )}

          <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {visibleSkills.length === 0 ? (
              <div className="rounded-lg border border-dashed border-bench-200 bg-white px-4 py-8 text-center text-sm text-bench-700">
                No skills match the current filters.
              </div>
            ) : visibleSkills.map((skill) => (
              <button
                key={skill.id}
                onClick={() => void selectSkill(skill.name)}
                className={cn(
                  "w-full rounded-lg border bg-white p-3 text-left shadow-sm transition hover:border-bench-300 hover:bg-bench-50",
                  selectedSkill?.name === skill.name ? "border-bench-900" : "border-bench-200",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{skill.name}</div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-bench-700">{skill.description}</p>
                  </div>
                  <span className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                    skill.enabled ? "bg-lime-50 text-lime-800 ring-1 ring-lime-200" : "bg-bench-50 text-bench-600 ring-1 ring-bench-200",
                  )}>
                    {skill.enabled ? "on" : "off"}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-semibold text-bench-700">
                  <span className="rounded-full bg-bench-50 px-2 py-0.5 ring-1 ring-inset ring-bench-200">{skill.category}</span>
                  <span className="rounded-full bg-bench-50 px-2 py-0.5 ring-1 ring-inset ring-bench-200">
                    {skill.editable ? "editable" : "read-only"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <div className={cn(
          "grid min-h-0 overflow-hidden",
          fileDrawer ? "xl:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]" : "grid-cols-1",
        )}>
          <main className="min-h-0 overflow-y-auto px-6 py-6">
            {mode === "create" || mode === "edit" ? (
            <section className="rounded-lg bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{mode === "create" ? "Create private skill" : `Edit ${draft.name}`}</h3>
                  <p className="mt-1 text-xs text-bench-700">Private skills are stored as `.ora/skills/private/&lt;name&gt;/` packages.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={cancelDraft}
                    disabled={busy.length > 0}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-4 text-sm font-semibold transition hover:bg-bench-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveSkill}
                    disabled={busy.length > 0 || !draft.name.trim()}
                    className="inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {mode === "create" ? "Create skill" : "Save changes"}
                  </button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Name</span>
                  <input
                    value={draft.name}
                    onChange={(event) => setDraft((current) => {
                      const nextName = event.target.value;
                      return {
                        ...current,
                        name: nextName,
                        content: syncSkillContentMetadata(current.content, nextName, current.description),
                      };
                    })}
                    placeholder="research-review"
                    className="h-10 w-full rounded-md border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">State</span>
                  <button
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, enabled: !current.enabled }))}
                    className="h-10 w-full rounded-md border border-bench-200 bg-bench-50 px-3 text-left text-sm font-semibold transition hover:bg-white"
                  >
                    {draft.enabled ? "Enabled" : "Disabled"}
                  </button>
                </label>
                <label className="space-y-1.5 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Description</span>
                  <textarea
                    value={draft.description}
                    onChange={(event) => setDraft((current) => {
                      const nextDescription = event.target.value;
                      return {
                        ...current,
                        description: nextDescription,
                        content: syncSkillContentMetadata(current.content, current.name, nextDescription),
                      };
                    })}
                    rows={3}
                    placeholder="What this skill helps the agent do."
                    className="w-full rounded-md border border-bench-200 bg-bench-50 px-3 py-2 text-sm outline-none transition focus:border-bench-900"
                  />
                </label>
                <label className="space-y-1.5 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">SKILL.md</span>
                  <textarea
                    value={draft.content}
                    onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
                    rows={18}
                    placeholder={`---\nname: ${draft.name || "research-review"}\ndescription: ${draft.description || "What this skill helps the agent do."}\n---\n\n# ${draft.name || "research-review"}`}
                    className="w-full rounded-md border border-bench-200 bg-bench-50 px-3 py-2 font-mono text-sm outline-none transition focus:border-bench-900"
                  />
                </label>
              </div>
            </section>
            ) : selectedSkill ? (
            <section className="space-y-4">
              <div className="rounded-lg bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold">{selectedSkill.name}</h3>
                      <span className="rounded-full bg-bench-50 px-2 py-0.5 text-[11px] font-semibold uppercase text-bench-700 ring-1 ring-inset ring-bench-200">
                        {selectedSkill.category}
                      </span>
                    </div>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-bench-700">{selectedSkill.description}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void toggleSkill(selectedSkill)}
                      disabled={busy.length > 0}
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-xs font-semibold transition hover:bg-bench-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Eye size={14} />
                      {selectedSkill.enabled ? "Disable" : "Enable"}
                    </button>
                    {selectedSkill.editable && (
                      <>
                        <button
                          onClick={startEdit}
                          disabled={busy.length > 0}
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-xs font-semibold transition hover:bg-bench-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Pencil size={14} />
                          Edit
                        </button>
                        <button
                          onClick={() => void deleteSkill()}
                          disabled={busy.length > 0}
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-xs font-semibold transition hover:bg-bench-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
              {(selectedSkill.files ?? []).length > 0 && (
                <div className="rounded-lg bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold">Package files</h4>
                    <button
                      type="button"
                      onClick={startNewPackageFile}
                      className="inline-flex h-8 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-xs font-semibold transition hover:bg-bench-50 active:scale-[0.98]"
                    >
                      <Plus size={13} />
                      New file
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {(selectedSkill.files ?? []).map((file) => (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => void openPackageFile(file)}
                        className={cn(
                          "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-xs transition hover:bg-white active:scale-[0.99]",
                          fileDrawer?.path === file.path ? "border-bench-900 bg-white" : "border-bench-200 bg-bench-50",
                        )}
                      >
                        <span className="min-w-0 truncate font-mono">{file.path}</span>
                        <span className="shrink-0 font-semibold uppercase text-bench-700">{file.kind}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(selectedSkill.files ?? []).length === 0 && (
                <div className="rounded-lg bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold">Package files</h4>
                    <button
                      type="button"
                      onClick={startNewPackageFile}
                      className="inline-flex h-8 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-xs font-semibold transition hover:bg-bench-50 active:scale-[0.98]"
                    >
                      <Plus size={13} />
                      New file
                    </button>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-bench-700">No supporting files yet.</p>
                </div>
              )}
              <pre className="min-h-[420px] overflow-x-auto rounded-lg bg-white p-5 font-mono text-xs leading-5 shadow-pane ring-1 ring-inset ring-bench-200">
                {selectedSkill.content}
              </pre>
            </section>
            ) : (
            <div className="flex h-full min-h-[420px] items-center justify-center">
              <div className="rounded-lg bg-white p-6 text-center shadow-pane ring-1 ring-inset ring-bench-200">
                <p className="text-sm font-semibold">Select a skill to view full information.</p>
              </div>
            </div>
            )}
          </main>
          {fileDrawer && (
            <div className="min-h-0 border-l border-border bg-card/40">
              <SkillPackageFileDrawer
                state={fileDrawer}
                onClose={closePackageFile}
                onSave={() => void savePackageFile()}
                onDelete={() => void deletePackageFile()}
                onDraftPathChange={(draftPath) => setFileDrawer((current) => current ? { ...current, draftPath } : current)}
                onDraftContentChange={(draftContent) => setFileDrawer((current) => current ? { ...current, draftContent } : current)}
                onExecutableChange={(executable) => setFileDrawer((current) => current ? { ...current, executable } : current)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function fileContentToDrawer(file: OraSkillPackageFileContent): FileDrawerState {
  return {
    mode: "existing",
    path: file.path,
    draftPath: file.path,
    content: file.content,
    draftContent: file.content,
    executable: file.executable,
    kind: file.kind,
    loading: false,
    busy: false,
    error: "",
  };
}

function fileDrawerChanged(state: FileDrawerState): boolean {
  return state.path !== state.draftPath || state.content !== state.draftContent;
}

function SkillPackageFileDrawer({
  state,
  onClose,
  onSave,
  onDelete,
  onDraftPathChange,
  onDraftContentChange,
  onExecutableChange,
}: {
  state: FileDrawerState;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  onDraftPathChange: (value: string) => void;
  onDraftContentChange: (value: string) => void;
  onExecutableChange: (value: boolean) => void;
}) {
  const changed = fileDrawerChanged(state);
  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col bg-transparent">
      <header className="flex h-12 shrink-0 items-center justify-between bg-card/74 px-4 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2">
          <SkillPackageFileIcon kind={state.kind} path={state.draftPath || state.path} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium">Package file</h2>
            <p data-i18n-skip="" className="truncate text-[11px] text-muted-foreground">
              {state.draftPath || "New supporting file"}
            </p>
          </div>
        </div>
        <Button onClick={onClose} variant="ghost" size="icon-sm" title="Close package file">
          <X size={16} />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
        {state.loading ? (
          <div className="rounded-xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">
            Loading package file.
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {state.error && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
                {state.error}
              </div>
            )}

            <label className="space-y-1.5">
              <span className="text-[11px] font-semibold uppercase text-muted-foreground">Path</span>
              <input
                value={state.draftPath}
                onChange={(event) => onDraftPathChange(event.target.value)}
                readOnly={state.mode === "existing"}
                placeholder="templates/result.md"
                className="h-9 w-full rounded-md border border-border bg-background px-3 font-mono text-xs outline-none transition focus:border-foreground/40 read-only:text-muted-foreground"
              />
            </label>

            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <input
                type="checkbox"
                checked={state.executable}
                onChange={(event) => onExecutableChange(event.target.checked)}
                className="h-3.5 w-3.5"
              />
              Executable
            </label>

            <textarea
              value={state.draftContent}
              onChange={(event) => onDraftContentChange(event.target.value)}
              spellCheck={false}
              className="min-h-[420px] flex-1 resize-none rounded-md border border-border bg-background p-3 font-mono text-xs leading-5 text-bench-800 outline-none transition focus:border-foreground/40"
            />

            <div className="flex shrink-0 items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onDelete}
                disabled={state.mode === "new" || state.busy}
              >
                <Trash2 size={14} />
                Delete
              </Button>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={state.busy}>
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={onSave} disabled={state.busy || !state.draftPath.trim() || !changed}>
                  <Save size={14} />
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function SkillPackageFileIcon({ kind, path }: { kind?: SkillPackageFileEntry["kind"]; path: string }) {
  if (kind === "script" || /\.(ts|tsx|js|jsx|py|sh|bash|json|ya?ml)$/i.test(path)) {
    return <FileCode2 size={16} className="text-muted-foreground" />;
  }
  return <FileText size={16} className="text-muted-foreground" />;
}
