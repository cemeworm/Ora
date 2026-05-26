import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArtifactDrawer } from "./ArtifactDrawer";
import type { ArtifactRecord } from "../types";

function artifact(extra: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    id: extra.id ?? "artifact-1",
    label: extra.label ?? "artifact.html",
    kind: extra.kind ?? "file",
    mimeType: extra.mimeType ?? "text/html",
    createdAt: extra.createdAt ?? "13:40",
    uri: extra.uri,
    sizeBytes: extra.sizeBytes,
    payload: extra.payload,
  };
}

describe("ArtifactDrawer", () => {
  it("renders HTML file-change artifacts as a browser preview by default", () => {
    const markup = renderToStaticMarkup(
      <ArtifactDrawer
        artifact={artifact({
          label: "apps/desktop/public/lightfox.html",
          payload: {
            kind: "file_change",
            afterContent: "<!doctype html><html><body><h1>Light Fox</h1><script>window.__ready = true;</script></body></html>",
          },
        })}
      />,
    );

    expect(markup).toContain("<iframe");
    expect(markup).toContain("Light Fox");
    expect(markup).toContain("sandbox=\"allow-scripts\"");
    expect(markup).not.toContain("<pre");
  });

  it("renders inline HTML payload artifacts as a browser preview", () => {
    const markup = renderToStaticMarkup(
      <ArtifactDrawer
        artifact={artifact({
          id: "artifact-inline-html",
          label: "report.html",
          payload: "<html><body><main>Inline report</main></body></html>",
        })}
      />,
    );

    expect(markup).toContain("<iframe");
    expect(markup).toContain("Inline report");
    expect(markup).toContain("Preview");
    expect(markup).toContain("Source");
  });

  it("keeps non-HTML file-change artifacts in source view", () => {
    const markup = renderToStaticMarkup(
      <ArtifactDrawer
        artifact={artifact({
          id: "artifact-ts-change",
          label: "src/example.ts",
          mimeType: "text/typescript",
          payload: {
            kind: "file_change",
            afterContent: "export const answer = 42;",
          },
        })}
      />,
    );

    expect(markup).toContain("<pre");
    expect(markup).toContain("export const answer = 42;");
    expect(markup).not.toContain("<iframe");
  });

  it("does not grant high-risk iframe sandbox permissions", () => {
    const markup = renderToStaticMarkup(
      <ArtifactDrawer
        artifact={artifact({
          id: "artifact-sandbox-html",
          payload: "<html><body>Sandboxed</body></html>",
        })}
      />,
    );

    expect(markup).toContain("sandbox=\"allow-scripts\"");
    expect(markup).not.toContain("allow-same-origin");
    expect(markup).not.toContain("allow-forms");
    expect(markup).not.toContain("allow-popups");
    expect(markup).not.toContain("allow-top-navigation");
  });
});
