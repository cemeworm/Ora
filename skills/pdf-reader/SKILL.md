---
name: pdf-reader
description: Use this skill whenever the user asks Ora to read, parse, summarize, analyze, extract text from, or answer questions about a PDF file, PDF URL, arXiv PDF, uploaded paper, or local .pdf path. This skill should trigger before generic web.fetch or file.read on PDFs so Ora does not treat PDF binary bytes as readable text.
agent_created: true
---

# PDF Reader Skill

## Purpose

PDFs are binary documents. Do not use plain `web.fetch` or `file.read` as if the PDF were UTF-8 text. Those tools may return PDF bytes or compressed streams, which are not reliable source text.

Use this skill to route PDF requests through document extraction or a safe fallback.

## Workflow

### 1. Identify the PDF source

Classify the user input as one of:

- **Local PDF path**: ends with `.pdf` or the user says a local/uploaded PDF is attached.
- **PDF URL**: URL ends with `.pdf`, has `/pdf/` in the path, or is known to return `application/pdf`.
- **arXiv link**: `arxiv.org/abs/...`, `arxiv.org/pdf/...`, or `arxiv.org/html/...`.
- **Unknown document**: user says "PDF" but has not provided a path, URL, or attachment.

If the source is unknown, ask the user for the PDF path, URL, or upload.

### 2. Prefer native document extraction

If the `document.extract` tool is available, use it first:

```json
{"tool":"document.extract","args":{"path":"paper.pdf","format":"text"}}
```

or:

```json
{"tool":"document.extract","args":{"url":"https://example.com/paper.pdf","format":"text"}}
```

Use `format: "markdown"` when the user wants notes, summaries, or a report. Use `format: "text"` when the user wants exact extraction.

### 3. Handle arXiv carefully

For arXiv:

1. Normalize `https://arxiv.org/pdf/<id>` as the PDF source for full-text extraction.
2. Use `https://arxiv.org/abs/<id>` or `https://arxiv.org/html/<id>` only as fallback for metadata or partial HTML content.
3. If `web.fetch` reports that the URL is a PDF, call `document.extract` instead of summarizing the warning.

### 4. Use MCP or DeerFlow as fallback

If `document.extract` is unavailable or fails:

1. Use `mcp.listTools` to check whether a configured MCP server exposes a PDF/document parser.
2. If a suitable parser exists, call it with `mcp.call` after the user approves external tool usage.
3. For research-paper tasks and if DeerFlow is available, use `claude-to-deerflow` upload flow; it supports PDF/PPTX/XLSX/DOCX conversion to Markdown.

### 5. Be explicit about limitations

If all extraction routes fail, say so plainly. Do not infer the PDF contents from the filename, abstract page, search snippets, or binary bytes.

Common limitations:

- Scanned/image-only PDFs require OCR, which native `document.extract` does not provide yet.
- Password-protected PDFs may fail unless the parser supports credentials.
- Large PDFs may be truncated to fit tool output limits.

## Output guidance

When extraction succeeds, answer from extracted text and mention whether the result was truncated. For academic papers, include section/page references when available; if page structure is unavailable, avoid pretending exact page citations exist.
