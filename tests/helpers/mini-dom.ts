// A tiny DOM for adapter tests: elements, text nodes, and the selector subset
// the extension adapters use — tag, [attr], [attr="v"], [attr*="v"],
// descendant combinators and comma lists. Not a browser; just enough shape.

type Attrs = Record<string, string>;

export class MiniText {
  nodeType = 3;
  parentElement: MiniElement | null = null;
  constructor(public nodeValue: string) {}
  get textContent() {
    return this.nodeValue;
  }
}

type Compound = { tag?: string; attrs: { name: string; op?: "=" | "*="; value?: string }[] };

const parseCompound = (raw: string): Compound => {
  const tagMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(raw);
  const attrs: Compound["attrs"] = [];
  const attrPattern = /\[([a-zA-Z-]+)(?:(\*?=)"([^"]*)")?\]/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(raw))) {
    attrs.push({
      name: match[1]!,
      op: match[2] as "=" | "*=" | undefined,
      value: match[3],
    });
  }
  return { tag: tagMatch?.[0]?.toUpperCase(), attrs };
};

const matchesCompound = (el: MiniElement, compound: Compound) => {
  if (compound.tag && el.tagName !== compound.tag) return false;
  return compound.attrs.every((attr) => {
    const value = el.getAttribute(attr.name);
    if (value === null) return false;
    if (!attr.op) return true;
    return attr.op === "=" ? value === attr.value : value.includes(attr.value ?? "");
  });
};

const matchesSelector = (el: MiniElement, selector: string): boolean =>
  selector.split(",").some((part) => {
    const compounds = part.trim().split(/\s+/).map(parseCompound);
    let index = compounds.length - 1;
    if (!matchesCompound(el, compounds[index]!)) return false;
    index -= 1;
    let ancestor = el.parentElement;
    while (index >= 0 && ancestor) {
      if (matchesCompound(ancestor, compounds[index]!)) index -= 1;
      ancestor = ancestor.parentElement;
    }
    return index < 0;
  });

export class MiniElement {
  nodeType = 1;
  tagName: string;
  attrs: Attrs;
  childNodes: Array<MiniElement | MiniText> = [];
  parentElement: MiniElement | null = null;
  // Media-ish props some adapters read.
  naturalWidth = 0;
  naturalHeight = 0;
  currentSrc = "";
  src = "";

  constructor(tag: string, attrs: Attrs = {}, children: Array<MiniElement | MiniText | string> = []) {
    this.tagName = tag.toUpperCase();
    this.attrs = attrs;
    if (attrs.src) {
      this.src = attrs.src;
      this.currentSrc = attrs.src;
    }
    for (const child of children) {
      const node = typeof child === "string" ? new MiniText(child) : child;
      node.parentElement = this;
      this.childNodes.push(node);
    }
  }

  getAttribute(name: string) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name]! : null;
  }

  hasAttribute(name: string) {
    return this.getAttribute(name) !== null;
  }

  get textContent(): string {
    return this.childNodes.map((node) => node.textContent).join("");
  }

  private descendants(): MiniElement[] {
    const out: MiniElement[] = [];
    const walk = (node: MiniElement) => {
      for (const child of node.childNodes) {
        if (child instanceof MiniElement) {
          out.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return out;
  }

  querySelectorAll(selector: string) {
    return this.descendants().filter((el) => matchesSelector(el, selector));
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  closest(selector: string): MiniElement | null {
    if (matchesSelector(this, selector)) return this;
    return this.parentElement ? this.parentElement.closest(selector) : null;
  }

  contains(other: MiniElement | MiniText | null): boolean {
    let node = other as MiniElement | MiniText | null;
    while (node) {
      if (node === this) return true;
      node = node.parentElement;
    }
    return false;
  }
}

export const h = (
  tag: string,
  attrs: Attrs = {},
  ...children: Array<MiniElement | MiniText | string>
) => new MiniElement(tag, attrs, children);
