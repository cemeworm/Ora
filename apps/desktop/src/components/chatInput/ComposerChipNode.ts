import {
  addClassNamesToElement,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
  TextNode,
} from "lexical";

export type ComposerChipTone = "widget" | undefined;
export type ComposerChipKind = "skill" | "context";

export type SerializedComposerChipNode = Spread<
  {
    chipId: string;
    chipKind: ComposerChipKind;
    label: string;
    tone?: ComposerChipTone;
  },
  SerializedTextNode
>;

export class ComposerChipNode extends TextNode {
  __chipId: string;
  __chipKind: ComposerChipKind;
  __label: string;
  __tone?: ComposerChipTone;

  static getType(): string {
    return "composer-chip";
  }

  static clone(node: ComposerChipNode): ComposerChipNode {
    return new ComposerChipNode(
      node.__chipKind,
      node.__chipId,
      node.__label,
      node.__tone,
      node.__key,
    );
  }

  static importJSON(
    serializedNode: SerializedComposerChipNode,
  ): ComposerChipNode {
    return $createComposerChipNode({
      chipId: serializedNode.chipId,
      chipKind: serializedNode.chipKind,
      label: serializedNode.label,
      tone: serializedNode.tone,
    }).updateFromJSON(serializedNode);
  }

  constructor(
    chipKind: ComposerChipKind,
    chipId: string,
    label: string,
    tone?: ComposerChipTone,
    key?: NodeKey,
  ) {
    super(label, key);
    this.__chipId = chipId;
    this.__chipKind = chipKind;
    this.__label = label;
    this.__tone = tone;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement("span");
    addClassNamesToElement(dom, ...chipClassName(this.__chipKind, this.__tone));
    dom.dataset.segmentKind =
      this.__chipKind === "skill" ? "skill-chip" : "context-chip";
    dom.dataset.chipKind = this.__chipKind;
    dom.dataset.chipId = this.__chipId;
    dom.textContent = this.__label;
    return dom;
  }

  updateDOM(prevNode: ComposerChipNode, dom: HTMLElement): boolean {
    if (
      prevNode.__label !== this.__label ||
      prevNode.__chipId !== this.__chipId ||
      prevNode.__chipKind !== this.__chipKind ||
      prevNode.__tone !== this.__tone
    ) {
      dom.className = "";
      addClassNamesToElement(dom, ...chipClassName(this.__chipKind, this.__tone));
      dom.dataset.segmentKind =
        this.__chipKind === "skill" ? "skill-chip" : "context-chip";
      dom.dataset.chipKind = this.__chipKind;
      dom.dataset.chipId = this.__chipId;
      dom.textContent = this.__label;
    }
    return false;
  }

  exportJSON(): SerializedComposerChipNode {
    return {
      ...super.exportJSON(),
      type: "composer-chip",
      chipId: this.__chipId,
      chipKind: this.__chipKind,
      label: this.__label,
      tone: this.__tone,
      version: 1,
    };
  }

  getChipId() {
    return this.__chipId;
  }

  getChipKind() {
    return this.__chipKind;
  }

  getChipLabel() {
    return this.__label;
  }

  getChipTone() {
    return this.__tone;
  }

  isTextEntity(): true {
    return true;
  }

  canInsertTextBefore(): false {
    return false;
  }

  canInsertTextAfter(): false {
    return false;
  }
}

function chipClassName(kind: ComposerChipKind, tone?: ComposerChipTone) {
  if (kind === "context") {
    return tone === "widget"
      ? [
          "mx-0.5",
          "inline-flex",
          "max-w-[220px]",
          "items-center",
          "rounded-full",
          "border",
          "border-emerald-200",
          "bg-emerald-50",
          "px-2",
          "py-0.5",
          "align-baseline",
          "text-sm",
          "font-medium",
          "text-emerald-700",
        ]
      : [
          "mx-0.5",
          "inline-flex",
          "max-w-[220px]",
          "items-center",
          "rounded-full",
          "border",
          "border-border",
          "bg-background/80",
          "px-2",
          "py-0.5",
          "align-baseline",
          "text-sm",
          "font-medium",
          "text-muted-foreground",
        ];
  }
  return [
    "mx-0.5",
    "inline-flex",
    "max-w-[220px]",
    "items-center",
    "rounded-full",
    "px-1",
    "py-0.5",
    "align-baseline",
    "text-sm",
    "font-medium",
    "text-violet-700",
  ];
}

export function $createComposerChipNode({
  chipId,
  chipKind,
  label,
  tone,
}: {
  chipId: string;
  chipKind: ComposerChipKind;
  label: string;
  tone?: ComposerChipTone;
}) {
  return new ComposerChipNode(chipKind, chipId, label, tone).setMode(
    "token",
  ) as ComposerChipNode;
}

export function $isComposerChipNode(
  node: LexicalNode | null | undefined,
): node is ComposerChipNode {
  return node instanceof ComposerChipNode;
}
