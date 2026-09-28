import { hierarchy, tree, type HierarchyPointNode } from "d3-hierarchy";
import type { TreeNode } from "./tree";

export type SelectHandler = (node: TreeNode, ancestors: TreeNode[]) => void;

const NS = "http://www.w3.org/2000/svg";
const ROW = 34; // 兄弟ノードの縦間隔
const COL = 330; // 深さ 1 段ぶんの横間隔
const NODE_H = 26;
const MIN_W = 56;
const MAX_W = 290;
const PAD = 40;
const INITIAL_DEPTH = 2; // ここまでの深さは最初から展開
const BADGE_GAP = 4;
function badgeWidth(text: string): number {
  return Math.max(18, textWidth(text) + 8);
}

function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0xff ? 12 : 7;
  return w;
}

function fitLabel(s: string, maxW: number): string {
  if (textWidth(s) <= maxW) return s;
  let out = "";
  for (const ch of s) {
    if (textWidth(out + ch) + 12 > maxW) break;
    out += ch;
  }
  return `${out}…`;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/** 横方向ノードリンク図。d3-hierarchy でレイアウトし、SVG を直接組み立てる。 */
export class TreeView {
  private svg: SVGSVGElement;
  private g: SVGGElement;
  private root: TreeNode | null = null;
  private expanded = new Set<string>();
  private selected: string | null = null;
  private tx = PAD;
  private ty = PAD;
  private k = 1;
  private drag: { x: number; y: number; tx: number; ty: number } | null = null;

  constructor(host: HTMLElement, private onSelect: SelectHandler) {
    this.svg = el("svg", { class: "tree-svg" });
    this.g = el("g");
    this.svg.append(this.g);
    host.append(this.svg);

    this.svg.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    this.svg.addEventListener("pointerdown", (e) => {
      if ((e.target as Element).closest(".node")) return;
      this.drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
      this.svg.setPointerCapture(e.pointerId);
    });
    this.svg.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      this.tx = this.drag.tx + (e.clientX - this.drag.x);
      this.ty = this.drag.ty + (e.clientY - this.drag.y);
      this.applyTransform();
    });
    const end = () => { this.drag = null; };
    this.svg.addEventListener("pointerup", end);
    this.svg.addEventListener("pointercancel", end);
  }

  setRoot(root: TreeNode): void {
    this.root = root;
    this.expanded.clear();
    this.selected = null;
    const walk = (n: TreeNode, d: number) => {
      if (n.children.length && d <= INITIAL_DEPTH) this.expanded.add(n.id);
      n.children.forEach((c) => walk(c, d + 1));
    };
    walk(root, 0);
    this.render();
    this.fit();
  }

  clear(): void {
    this.root = null;
    this.g.replaceChildren();
  }

  expandAll(): void {
    if (!this.root) return;
    const walk = (n: TreeNode) => { if (n.children.length) this.expanded.add(n.id); n.children.forEach(walk); };
    walk(this.root);
    this.render();
  }

  collapseAll(): void {
    if (!this.root) return;
    this.expanded = new Set([this.root.id]);
    this.render();
    this.fit();
  }

  /** 木全体が入るように縮小・移動する（拡大はしない） */
  fit(): void {
    if (!this.root) return;
    const bb = this.g.getBBox();
    const W = this.svg.clientWidth;
    const H = this.svg.clientHeight;
    if (!bb.width || !bb.height || !W || !H) return;
    this.k = Math.max(0.25, Math.min(1, (W - PAD * 2) / bb.width, (H - PAD * 2) / bb.height));
    this.tx = PAD - bb.x * this.k;
    this.ty = Math.max(PAD, (H - bb.height * this.k) / 2) - bb.y * this.k;
    this.applyTransform();
  }

  private applyTransform(): void {
    this.g.setAttribute("transform", `translate(${this.tx},${this.ty}) scale(${this.k})`);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const nk = Math.min(3, Math.max(0.15, this.k * Math.exp(-e.deltaY * 0.0015)));
    const f = nk / this.k;
    const r = this.svg.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    this.tx = px - (px - this.tx) * f;
    this.ty = py - (py - this.ty) * f;
    this.k = nk;
    this.applyTransform();
  }

  private badgesWidth(n: TreeNode): number {
    return (n.badges ?? []).reduce((w, b) => w + badgeWidth(b.text) + BADGE_GAP, 0);
  }

  private nodeWidth(n: TreeNode): number {
    return Math.min(MAX_W, Math.max(MIN_W, textWidth(n.label) + 24 + this.badgesWidth(n)));
  }

  render(): void {
    if (!this.root) return;
    const h = hierarchy<TreeNode>(this.root, (n) => (this.expanded.has(n.id) ? n.children : null));
    tree<TreeNode>().nodeSize([ROW, COL])(h);
    const pts = h as HierarchyPointNode<TreeNode>;
    const links = el("g", { class: "links" });
    const nodes = el("g", { class: "nodes" });

    for (const l of pts.links()) {
      const x0 = l.source.y + this.nodeWidth(l.source.data);
      const y0 = l.source.x;
      const x1 = l.target.y;
      const y1 = l.target.x;
      const mx = (x0 + x1) / 2;
      links.append(el("path", { class: "link", d: `M${x0},${y0}C${mx},${y0} ${mx},${y1} ${x1},${y1}` }));
    }

    for (const n of pts.descendants()) {
      const d = n.data;
      const w = this.nodeWidth(d);
      const g = el("g", {
        class: `node kind-${d.kind}${this.selected === d.id ? " selected" : ""}`,
        transform: `translate(${n.y},${n.x - NODE_H / 2})`,
      });
      g.append(el("rect", { width: w, height: NODE_H, rx: 6 }));
      let offset = 0;
      for (const badge of d.badges ?? []) {
        const bw = badgeWidth(badge.text);
        const b = el("g", { class: `badge ${badge.cls}`, transform: `translate(${7 + offset},${NODE_H / 2 - 8})` });
        b.append(el("rect", { width: bw, height: 16, rx: 8 }));
        const bt = el("text", { x: bw / 2, y: 12, "text-anchor": "middle" });
        bt.textContent = badge.text;
        b.append(bt);
        if (badge.title) {
          const title = el("title");
          title.textContent = badge.title;
          b.append(title);
        }
        g.append(b);
        offset += bw + BADGE_GAP;
      }
      const t = el("text", { x: 10 + offset, y: NODE_H / 2 + 4 });
      t.textContent = fitLabel(d.label, w - 20 - offset);
      g.append(t);
      const title = el("title");
      title.textContent = d.text ?? d.label;
      g.append(title);
      g.addEventListener("click", (e) => {
        e.stopPropagation();
        this.select(d, n.ancestors().reverse().map((a) => a.data));
      });
      if (d.children.length) {
        const open = this.expanded.has(d.id);
        const tg = el("g", { class: `toggle${open ? " open" : ""}`, transform: `translate(${w},${NODE_H / 2})` });
        tg.append(el("circle", { r: 8 }));
        const tt = el("text", { y: 3.5 });
        tt.textContent = open ? "−" : String(d.children.length);
        tg.append(tt);
        tg.addEventListener("click", (e) => {
          e.stopPropagation();
          this.toggle(d.id);
        });
        g.append(tg);
      }
      nodes.append(g);
    }
    this.g.replaceChildren(links, nodes);
  }

  private toggle(id: string): void {
    if (this.expanded.has(id)) this.expanded.delete(id);
    else this.expanded.add(id);
    this.render();
  }

  private select(d: TreeNode, ancestors: TreeNode[]): void {
    this.selected = d.id;
    this.render();
    this.onSelect(d, ancestors);
  }
}
