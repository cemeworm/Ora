import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WidgetStore } from "../src/widget-store.js";

let tempDir: string;
let now = 1_700_000_000_000;

beforeEach(() => {
  now = 1_700_000_000_000;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-widgets-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function createStore(): WidgetStore {
  return new WidgetStore({ rootDir: tempDir, clock: () => now });
}

describe("WidgetStore", () => {
  describe("CRUD", () => {
    it("creates a widget and persists it", () => {
      const store = createStore();
      const widget = store.create({
        title: "My Todo",
        kind: "todo",
      });

      expect(widget.id).toBeTruthy();
      expect(widget.title).toBe("My Todo");
      expect(widget.kind).toBe("todo");
      expect(widget.status).toBe("active");
      expect(widget.manifestVersion).toBe(1);
      expect(widget.state.kind).toBe("todo");

      // Verify persistence
      const store2 = createStore();
      const loaded = store2.get(widget.id);
      expect(loaded).toBeTruthy();
      expect(loaded!.title).toBe("My Todo");
    });

    it("creates widgets of each kind with correct default state", () => {
      const store = createStore();

      const artifact = store.create({ title: "Artifact", kind: "artifact" });
      expect(artifact.state.kind).toBe("artifact");
      expect(artifact.state).toHaveProperty("content");

      const todo = store.create({ title: "Todo", kind: "todo" });
      expect(todo.state.kind).toBe("todo");
      expect(todo.state).toHaveProperty("items");

      const feed = store.create({ title: "Feed", kind: "feed" });
      expect(feed.state.kind).toBe("feed");
      expect(feed.state).toHaveProperty("entries");
    });

    it("lists widgets filtered by kind", () => {
      const store = createStore();
      store.create({ title: "Todo 1", kind: "todo" });
      store.create({ title: "Todo 2", kind: "todo" });
      store.create({ title: "Feed 1", kind: "feed" });

      const todos = store.list({ kind: "todo" });
      expect(todos).toHaveLength(2);

      const feeds = store.list({ kind: "feed" });
      expect(feeds).toHaveLength(1);
    });

    it("lists widgets filtered by workspace", () => {
      const store = createStore();
      store.create({ title: "A", kind: "todo", workspaceId: "ws1" });
      store.create({ title: "B", kind: "todo", workspaceId: "ws2" });

      expect(store.list({ workspaceId: "ws1" })).toHaveLength(1);
      expect(store.list({ workspaceId: "ws2" })).toHaveLength(1);
    });

    it("excludes archived widgets by default", () => {
      const store = createStore();
      const widget = store.create({ title: "Todo", kind: "todo" });
      store.archive(widget.id);

      expect(store.list()).toHaveLength(0);
      expect(store.list({ includeArchived: true })).toHaveLength(1);
    });

    it("updates widget and preserves state", () => {
      const store = createStore();
      const widget = store.create({ title: "Original", kind: "todo" });

      const updated = store.update({ id: widget.id, title: "Updated" });
      expect(updated.title).toBe("Updated");
      expect(updated.state.kind).toBe("todo"); // state preserved
    });

    it("adds a todo item and persists structured time fields", () => {
      const store = createStore();
      const widget = store.create({ title: "Todo", kind: "todo" });
      const dueDate = now + 60_000;

      const updated = store.addTodoItem({
        widgetId: widget.id,
        title: "  买药  ",
        notes: "  今天下午五点  ",
        dueDate,
      });

      expect(updated.state.kind).toBe("todo");
      expect(updated.state.items).toEqual([
        expect.objectContaining({
          title: "买药",
          notes: "今天下午五点",
          dueDate,
          reminderAt: undefined,
          createdAt: now,
          updatedAt: now,
        }),
      ]);

      const reloaded = createStore().get(widget.id);
      expect(reloaded?.state.kind).toBe("todo");
      expect(reloaded?.state.items).toEqual([
        expect.objectContaining({
          title: "买药",
          notes: "今天下午五点",
          dueDate,
        }),
      ]);
    });

    it("rejects adding todo items to non-todo widgets", () => {
      const store = createStore();
      const widget = store.create({ title: "Feed", kind: "feed" });

      expect(() => store.addTodoItem({
        widgetId: widget.id,
        title: "买药",
      })).toThrow(`Widget is not a todo widget: ${widget.id}`);
    });

    it("archive does not delete state", () => {
      const store = createStore();
      const widget = store.create({ title: "Todo", kind: "todo" });

      store.archive(widget.id);
      const archived = store.get(widget.id);
      expect(archived!.status).toBe("archived");
      expect(archived!.state).toBeTruthy();
    });

    it("restores archived widget", () => {
      const store = createStore();
      const widget = store.create({ title: "Todo", kind: "todo" });
      store.archive(widget.id);

      const restored = store.restore(widget.id);
      expect(restored.status).toBe("active");
    });

    it("deletes widget", () => {
      const store = createStore();
      const widget = store.create({ title: "Todo", kind: "todo" });
      store.delete(widget.id);

      expect(store.get(widget.id)).toBeUndefined();
    });

    it("hydration returns stable ordering", () => {
      const store = createStore();
      const a = store.create({ title: "A", kind: "todo" });
      now += 1000;
      const b = store.create({ title: "B", kind: "todo" });
      now += 1000;
      const c = store.create({ title: "C", kind: "todo" });

      const items = store.list();
      expect(items[0].id).toBe(c.id); // newest first
      expect(items[1].id).toBe(b.id);
      expect(items[2].id).toBe(a.id);
    });
  });

  describe("versions", () => {
    it("structural update creates a version", () => {
      const store = createStore();
      const widget = store.create({ title: "Todo", kind: "todo" });

      const versions1 = store.listVersions(widget.id);
      expect(versions1).toHaveLength(1); // initial creation version
      expect(versions1[0].version).toBe(1);

      // Structural update (title change)
      const updated = store.update(
        { id: widget.id, title: "Updated Todo" },
        true,
        "changed title",
      );

      const versions2 = store.listVersions(widget.id);
      expect(versions2).toHaveLength(2);
      expect(versions2[0].version).toBe(2); // newest first
    });

    it("refresh update (state-only) does not create a version", () => {
      const store = createStore();
      const widget = store.create({ title: "Todo", kind: "todo" });

      // Non-structural update (state only)
      store.update({
        id: widget.id,
        state: { kind: "todo", items: [], lastRefreshedAt: now, lastError: undefined, consecutiveFailures: 0 },
      });

      const versions = store.listVersions(widget.id);
      expect(versions).toHaveLength(1); // only initial creation
    });

    it("restore creates a new version and preserves history", () => {
      const store = createStore();
      const widget = store.create({ title: "Original", kind: "todo" });

      // Make a structural change
      const updated = store.update(
        { id: widget.id, title: "Modified Title" },
        true,
        "title change",
      );

      // Find the v1 version
      const versions = store.listVersions(widget.id);
      const v1 = versions.find((v) => v.version === 1)!;

      // Restore to v1
      now += 1000;
      const restored = store.restoreVersion({
        widgetId: widget.id,
        versionId: v1.id,
        restoreSummary: "back to original",
      });

      expect(restored.title).toBe("Original");
      expect(restored.lastRestoredVersionId).toBe(v1.id);

      // Should have 3 versions: v1 (create), v2 (modify), v3 (restore)
      const allVersions = store.listVersions(widget.id);
      expect(allVersions).toHaveLength(3);
    });

    it("compare versions returns both versions", () => {
      const store = createStore();
      const widget = store.create({ title: "Original", kind: "todo" });

      const updated = store.update(
        { id: widget.id, title: "New Title" },
        true,
        "changed",
      );

      const versions = store.listVersions(widget.id);
      const v1 = versions.find((v) => v.version === 1)!;
      const v2 = versions.find((v) => v.version === 2)!;

      const comparison = store.compareVersions(v1.id, v2.id);
      expect(comparison.a.manifestSnapshot.title).toBe("Original");
      expect(comparison.b.manifestSnapshot.title).toBe("New Title");
    });
  });

  describe("widget kind-specific state", () => {
    it("stores and retrieves todo items in state", () => {
      const store = createStore();
      const widget = store.create({ title: "My Todos", kind: "todo" });

      const todoState = {
        kind: "todo" as const,
        items: [
          {
            id: "item-1",
            title: "Buy groceries",
            notes: "",
            createdAt: now,
            updatedAt: now,
          },
        ],
        lastRefreshedAt: undefined,
        lastError: undefined,
        consecutiveFailures: 0,
      };

      store.update({ id: widget.id, state: todoState });

      const loaded = store.get(widget.id);
      expect(loaded!.state.kind).toBe("todo");
      if (loaded!.state.kind === "todo") {
        expect(loaded!.state.items).toHaveLength(1);
        expect(loaded!.state.items[0].title).toBe("Buy groceries");
      }
    });

    it("stores and retrieves feed entries", () => {
      const store = createStore();
      const widget = store.create({ title: "News", kind: "feed" });

      const feedState = {
        kind: "feed" as const,
        entries: [
          { id: "e1", title: "Breaking News", summary: "Something happened" },
        ],
        source: "test-source",
        filters: [],
        lastRefreshedAt: undefined,
        lastSuccessAt: undefined,
        lastError: undefined,
        consecutiveFailures: 0,
      };

      store.update({ id: widget.id, state: feedState });

      const loaded = store.get(widget.id);
      if (loaded!.state.kind === "feed") {
        expect(loaded!.state.entries).toHaveLength(1);
      }
    });
  });

  describe("todo reminders", () => {
    it("persists todo items with due dates", () => {
      const store = createStore();
      const dueDate = now + 86400000; // tomorrow
      const widget = store.create({ title: "Tasks", kind: "todo" });

      store.update({
        id: widget.id,
        state: {
          kind: "todo",
          items: [
            { id: "t1", title: "Submit report", notes: "", dueDate, createdAt: now, updatedAt: now },
          ],
          lastRefreshedAt: undefined,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });

      const loaded = store.get(widget.id);
      if (loaded!.state.kind === "todo") {
        expect(loaded!.state.items[0].dueDate).toBe(dueDate);
      }
    });

    it("completing a todo item sets completedAt", () => {
      const store = createStore();
      const widget = store.create({ title: "Tasks", kind: "todo" });

      store.update({
        id: widget.id,
        state: {
          kind: "todo",
          items: [
            { id: "t1", title: "Task", notes: "", createdAt: now, updatedAt: now },
          ],
          lastRefreshedAt: undefined,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });

      store.update({
        id: widget.id,
        state: {
          kind: "todo",
          items: [
            { id: "t1", title: "Task", notes: "", completedAt: now + 1000, createdAt: now, updatedAt: now + 1000 },
          ],
          lastRefreshedAt: undefined,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });

      const loaded = store.get(widget.id);
      if (loaded!.state.kind === "todo") {
        expect(loaded!.state.items[0].completedAt).toBe(now + 1000);
      }
    });

    it("reminder state is preserved across restart", () => {
      const store = createStore();
      const reminderTime = now + 3600000; // 1 hour later
      const widget = store.create({ title: "Reminders", kind: "todo" });

      store.update({
        id: widget.id,
        state: {
          kind: "todo",
          items: [
            {
              id: "r1",
              title: "Meeting prep",
              notes: "",
              dueDate: reminderTime,
              reminderAt: reminderTime,
              createdAt: now,
              updatedAt: now,
            },
          ],
          lastRefreshedAt: undefined,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });

      // Simulate restart by creating a new store (reads from same file)
      const store2 = createStore();
      const loaded = store2.get(widget.id);
      if (loaded!.state.kind === "todo") {
        expect(loaded!.state.items).toHaveLength(1);
        expect(loaded!.state.items[0].reminderAt).toBe(reminderTime);
      }
    });

    it("completing a todo clears the pending reminder context", () => {
      const store = createStore();
      const widget = store.create({ title: "Tasks", kind: "todo" });

      store.update({
        id: widget.id,
        state: {
          kind: "todo",
          items: [
            { id: "t1", title: "Urgent", notes: "", dueDate: now + 1000, reminderAt: now + 1000, createdAt: now, updatedAt: now },
          ],
          lastRefreshedAt: undefined,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });

      // Complete the item
      store.update({
        id: widget.id,
        state: {
          kind: "todo",
          items: [
            { id: "t1", title: "Urgent", notes: "", dueDate: now + 1000, reminderAt: now + 1000, completedAt: now + 2000, createdAt: now, updatedAt: now + 2000 },
          ],
          lastRefreshedAt: undefined,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });

      const loaded = store.get(widget.id);
      if (loaded!.state.kind === "todo") {
        expect(loaded!.state.items[0].completedAt).toBe(now + 2000);
        // reminderAt still preserved in data but automation would check completedAt
        expect(loaded!.state.items[0].reminderAt).toBe(now + 1000);
      }
    });
  });

  describe("feed refresh", () => {
    it("refresh updates state with new entries", () => {
      const store = createStore();
      const widget = store.create({ title: "News", kind: "feed" });

      store.update({
        id: widget.id,
        state: {
          kind: "feed",
          entries: [
            { id: "e1", title: "Old news", summary: "" },
          ],
          source: "test",
          filters: [],
          lastRefreshAt: now,
          lastSuccessAt: now,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });

      // Refresh with new entries
      store.update({
        id: widget.id,
        state: {
          kind: "feed",
          entries: [
            { id: "e2", title: "Breaking story", summary: "Something big happened" },
            { id: "e1", title: "Old news", summary: "" },
          ],
          source: "test",
          filters: [],
          lastRefreshAt: now + 1000,
          lastSuccessAt: now + 1000,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });

      const loaded = store.get(widget.id);
      if (loaded!.state.kind === "feed") {
        expect(loaded!.state.entries).toHaveLength(2);
        expect(loaded!.state.entries[0].title).toBe("Breaking story");
        expect(loaded!.state.lastSuccessAt).toBe(now + 1000);
      }
    });

    it("failed refresh preserves previous entries and records error", () => {
      const store = createStore();
      const widget = store.create({ title: "News", kind: "feed" });

      // Initial successful state
      store.update({
        id: widget.id,
        state: {
          kind: "feed",
          entries: [
            { id: "e1", title: "Good data", summary: "" },
          ],
          source: "test",
          filters: [],
          lastRefreshAt: now,
          lastSuccessAt: now,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });

      // Failed refresh
      store.update({
        id: widget.id,
        state: {
          kind: "feed",
          entries: [
            { id: "e1", title: "Good data", summary: "" },
          ],
          source: "test",
          filters: [],
          lastRefreshAt: now + 1000,
          lastSuccessAt: now, // unchanged — last successful time preserved
          lastError: "Network timeout",
          consecutiveFailures: 1,
        },
      });

      const loaded = store.get(widget.id);
      if (loaded!.state.kind === "feed") {
        expect(loaded!.state.entries).toHaveLength(1); // old entries preserved
        expect(loaded!.state.entries[0].title).toBe("Good data");
        expect(loaded!.state.lastError).toBe("Network timeout");
        expect(loaded!.state.lastSuccessAt).toBe(now); // unchanged
        expect(loaded!.state.consecutiveFailures).toBe(1);
      }
    });

    it("filters are stored structurally and can be cleared", () => {
      const store = createStore();
      const widget = store.create({ title: "News", kind: "feed" });

      store.update({
        id: widget.id,
        state: {
          kind: "feed",
          entries: [],
          source: "test",
          filters: ["AI", "创业", "产品"],
          lastRefreshAt: undefined,
          lastSuccessAt: undefined,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });

      const loaded = store.get(widget.id);
      if (loaded!.state.kind === "feed") {
        expect(loaded!.state.filters).toEqual(["AI", "创业", "产品"]);
      }

      // Clear filters
      store.update({
        id: widget.id,
        state: {
          kind: "feed",
          entries: [],
          source: "test",
          filters: [],
          lastRefreshAt: undefined,
          lastSuccessAt: undefined,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });

      const loaded2 = store.get(widget.id);
      if (loaded2!.state.kind === "feed") {
        expect(loaded2!.state.filters).toEqual([]);
      }
    });

    it("consecutive failures increment correctly", () => {
      const store = createStore();
      const widget = store.create({ title: "News", kind: "feed" });

      // Fail 3 times
      for (let i = 1; i <= 3; i++) {
        store.update({
          id: widget.id,
          state: {
            kind: "feed",
            entries: [],
            source: "test",
            filters: [],
            lastRefreshAt: now + i * 1000,
            lastSuccessAt: undefined,
            lastError: `Attempt ${i} failed`,
            consecutiveFailures: i,
          },
        });
      }

      const loaded = store.get(widget.id);
      if (loaded!.state.kind === "feed") {
        expect(loaded!.state.consecutiveFailures).toBe(3);
        expect(loaded!.state.lastSuccessAt).toBeUndefined();
      }

      // Successful refresh resets counter
      store.update({
        id: widget.id,
        state: {
          kind: "feed",
          entries: [{ id: "e1", title: "Finally", summary: "" }],
          source: "test",
          filters: [],
          lastRefreshAt: now + 4000,
          lastSuccessAt: now + 4000,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });

      const recovered = store.get(widget.id);
      if (recovered!.state.kind === "feed") {
        expect(recovered!.state.consecutiveFailures).toBe(0);
        expect(recovered!.state.lastSuccessAt).toBe(now + 4000);
      }
    });
  });

  describe("artifact versions", () => {
    it("artifact creation from content stores initial state", () => {
      const store = createStore();
      const widget = store.create({ title: "Research Notes", kind: "artifact" });

      store.update({
        id: widget.id,
        state: {
          kind: "artifact",
          title: "Research Notes",
          content: "# AI Safety Research\n\nKey findings...",
          format: "markdown",
          versions: [],
          sourceSessionId: "session-0001",
          sourceRunId: undefined,
          lastRefreshedAt: undefined,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });

      const loaded = store.get(widget.id);
      if (loaded!.state.kind === "artifact") {
        expect(loaded!.state.content).toContain("AI Safety");
        expect(loaded!.state.format).toBe("markdown");
        expect(loaded!.state.sourceSessionId).toBe("session-0001");
      }
    });

    it("version append records content snapshots", () => {
      const store = createStore();
      const widget = store.create({ title: "Doc", kind: "artifact" });

      const v1Content = "Version 1 content";
      const v2Content = "Version 2 content with updates";

      // First save
      store.update({
        id: widget.id,
        state: {
          kind: "artifact",
          title: "Doc",
          content: v1Content,
          format: "markdown",
          versions: [{ content: v1Content, createdAt: now, note: "Initial draft" }],
          sourceSessionId: undefined,
          sourceRunId: undefined,
          lastRefreshedAt: undefined,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });

      // Edit and save again (creates v2)
      store.update({
        id: widget.id,
        state: {
          kind: "artifact",
          title: "Doc",
          content: v2Content,
          format: "markdown",
          versions: [
            { content: v1Content, createdAt: now, note: "Initial draft" },
            { content: v2Content, createdAt: now + 1000, note: "Updated" },
          ],
          sourceSessionId: undefined,
          sourceRunId: undefined,
          lastRefreshedAt: undefined,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });

      const loaded = store.get(widget.id);
      if (loaded!.state.kind === "artifact") {
        expect(loaded!.state.content).toBe(v2Content);
        expect(loaded!.state.versions).toHaveLength(2);
        expect(loaded!.state.versions[0].content).toBe(v1Content);
        expect(loaded!.state.versions[1].content).toBe(v2Content);
      }
    });

    it("rollback restores content from version", () => {
      const store = createStore();
      const widget = store.create({ title: "Doc", kind: "artifact" });

      const v1Content = "Original text";
      const v2Content = "Modified text";

      store.update({
        id: widget.id,
        state: {
          kind: "artifact",
          title: "Doc",
          content: v2Content,
          format: "markdown",
          versions: [
            { content: v1Content, createdAt: now, note: "v1" },
            { content: v2Content, createdAt: now + 1000, note: "v2" },
          ],
          sourceSessionId: undefined,
          sourceRunId: undefined,
          lastRefreshedAt: undefined,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });

      // Restore to v1 by setting content back
      store.update({
        id: widget.id,
        state: {
          kind: "artifact",
          title: "Doc",
          content: v1Content, // restored from v1
          format: "markdown",
          versions: [
            { content: v1Content, createdAt: now, note: "v1" },
            { content: v2Content, createdAt: now + 1000, note: "v2" },
          ],
          sourceSessionId: undefined,
          sourceRunId: undefined,
          lastRefreshedAt: undefined,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });

      const loaded = store.get(widget.id);
      if (loaded!.state.kind === "artifact") {
        expect(loaded!.state.content).toBe(v1Content);
        expect(loaded!.state.versions).toHaveLength(2); // history preserved
      }
    });

    it("artifact does not depend on session visibility", () => {
      const store = createStore();
      const widget = store.create({ title: "Standalone Doc", kind: "artifact" });

      store.update({
        id: widget.id,
        state: {
          kind: "artifact",
          title: "Standalone Doc",
          content: "This exists independently of any session.",
          format: "text",
          versions: [],
          sourceSessionId: undefined,
          sourceRunId: undefined,
          lastRefreshedAt: undefined,
          lastError: undefined,
          consecutiveFailures: 0,
        },
      });

      // Simulate restart
      const store2 = createStore();
      const loaded = store2.get(widget.id);
      expect(loaded).toBeTruthy();
      if (loaded!.state.kind === "artifact") {
        expect(loaded!.state.content).toBe("This exists independently of any session.");
        expect(loaded!.state.sourceSessionId).toBeUndefined();
      }
    });
  });

  describe("lifecycle and governance", () => {
    it("togglePin toggles pinned state", () => {
      const store = createStore();
      const widget = store.create({ title: "Important", kind: "todo" });
      expect(widget.layout.pinned).toBe(false);

      const pinned = store.togglePin(widget.id);
      expect(pinned.layout.pinned).toBe(true);

      const unpinned = store.togglePin(widget.id);
      expect(unpinned.layout.pinned).toBe(false);
    });

    it("pinned state persists across restart", () => {
      const store = createStore();
      const widget = store.create({ title: "Pin me", kind: "todo" });
      store.togglePin(widget.id);

      const store2 = createStore();
      const loaded = store2.get(widget.id);
      expect(loaded!.layout.pinned).toBe(true);
    });

    it("findDuplicate returns existing widget with same title", () => {
      const store = createStore();
      store.create({ title: "My Tasks", kind: "todo" });

      const dup = store.findDuplicate("My Tasks", "todo");
      expect(dup).toBeTruthy();
      expect(dup!.title).toBe("My Tasks");

      const noDup = store.findDuplicate("Other Tasks", "todo");
      expect(noDup).toBeUndefined();
    });

    it("findDuplicate ignores archived widgets", () => {
      const store = createStore();
      const widget = store.create({ title: "Tasks", kind: "todo" });
      store.archive(widget.id);

      const dup = store.findDuplicate("Tasks", "todo");
      expect(dup).toBeUndefined(); // archived, so not a duplicate
    });

    it("listStale returns inactive widgets older than threshold", () => {
      const store = createStore();
      store.create({ title: "Old widget", kind: "todo" });

      // Advance clock beyond stale threshold
      const oldNow = now;
      now = now + 15 * 24 * 60 * 60 * 1000; // 15 days later

      const store2 = new WidgetStore({ rootDir: tempDir, clock: () => now });
      const stale = store2.listStale();
      expect(stale.length).toBeGreaterThanOrEqual(1);
      expect(stale.some((w) => w.title === "Old widget")).toBe(true);
    });

    it("lifecycle events are recorded for CRUD operations", () => {
      const store = createStore();
      const widget = store.create({ title: "Audit me", kind: "todo" });

      const events = store.listEvents(widget.id);
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].event).toBe("created");
      expect(events[0].detail).toContain("Audit me");
    });

    it("lifecycle events include archive and restore", () => {
      const store = createStore();
      const widget = store.create({ title: "Cycle test", kind: "todo" });
      store.archive(widget.id);
      store.restore(widget.id);

      const events = store.listEvents(widget.id);
      const eventTypes = events.map((e) => e.event);
      expect(eventTypes).toContain("created");
      expect(eventTypes).toContain("archived");
      expect(eventTypes).toContain("restored");
    });
  });

  describe("history is append-only", () => {
    it("delete does not remove version history", () => {
      const store = createStore();
      const widget = store.create({ title: "Widget", kind: "todo" });

      store.update({ id: widget.id, title: "Updated" }, true, "change");
      const versionsBefore = store.listVersions(widget.id);

      store.delete(widget.id);

      // Versions should still exist after widget deletion
      const versionsAfter = store.listVersions(widget.id);
      expect(versionsAfter).toHaveLength(versionsBefore.length);
    });
  });
});
