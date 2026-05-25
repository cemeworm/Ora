import {
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  TextNode,
} from "lexical";

export class ComposerTextNode extends TextNode {
  static getType(): string {
    return "composer-text";
  }

  static clone(node: ComposerTextNode): ComposerTextNode {
    return new ComposerTextNode(node.__text, node.__key);
  }

  static importJSON(serializedNode: SerializedTextNode): ComposerTextNode {
    const node = $createComposerTextNode(serializedNode.text);
    node.updateFromJSON(serializedNode);
    return node;
  }

  constructor(text = "", key?: NodeKey) {
    super(text, key);
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.dataset.segmentKind = "text";
    dom.dataset.segmentId = this.getKey();
    return dom;
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const didUpdate = super.updateDOM(prevNode, dom, config);
    dom.dataset.segmentKind = "text";
    dom.dataset.segmentId = this.getKey();
    return didUpdate;
  }
}

export function $createComposerTextNode(text = "") {
  return new ComposerTextNode(text);
}

export function $isComposerTextNode(
  node: LexicalNode | null | undefined,
): node is ComposerTextNode {
  return node instanceof ComposerTextNode;
}
