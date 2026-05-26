import MarkdownIt from "markdown-it";
import katex from "katex";
import { stripReportBlock } from "./files.js";
import { parsePlotBlock, renderPlot, type RefEntry, type RefKind } from "./plot.js";

const CAPTION_COMMENT_PATTERN =
  /<!--\s*(graph|table)\s*:\s*([A-Za-z_][\w-]*)\s*:\s*([\s\S]*?)\s*-->/g;
const PLOT_FENCE_PATTERN = /```plot[^\n]*\r?\n([\s\S]*?)\r?\n```/g;
const SCAN_PATTERN =
  /<!--\s*(graph|table)\s*:\s*([A-Za-z_][\w-]*)\s*:\s*([\s\S]*?)\s*-->|```plot[^\n]*\r?\n([\s\S]*?)\r?\n```/g;

type ReferenceStore = {
  byVar: Map<string, RefEntry>;
};

type PrepareMarkdownResult = {
  markdown: string;
  refs: RefEntry[];
  warnings: string[];
};

type RefCounters = Record<RefKind, number>;

type MarkdownToken = {
  content: string;
  block?: boolean;
};

type InlineState = {
  src: string;
  pos: number;
  push(type: string, tag: string, nesting: number): MarkdownToken;
};

type BlockState = {
  src: string;
  bMarks: number[];
  tShift: number[];
  eMarks: number[];
  line: number;
  push(type: string, tag: string, nesting: number): MarkdownToken;
};

export function prepareMarkdown(source: string): PrepareMarkdownResult {
  const warnings: string[] = [];
  const body = stripReportBlock(source);
  const refs = collectReferences(body, warnings);

  let markdown = body.replace(PLOT_FENCE_PATTERN, (_match, content: string) => {
    const plot = parsePlotBlock(content, warnings);
    const entry = plot.varName ? refs.byVar.get(plot.varName) : undefined;
    return renderPlot(plot, entry);
  });

  markdown = markdown.replace(
    CAPTION_COMMENT_PATTERN,
    (_match, kind: RefKind, varName: string, caption: string) => {
    const entry = refs.byVar.get(varName);
    if (!entry) {
      return "";
    }
    return `<div class="kdrg-caption kdrg-${kind}-caption">${formatRef(entry)} ${escapeHtml(
      caption.trim(),
    )}</div>`;
    },
  );

  markdown = replaceReferencesOutsideCode(markdown, refs, warnings);
  markdown = numberHeadings(markdown);

  return {
    markdown,
    refs: Array.from(refs.byVar.values()),
    warnings,
  };
}

export function renderMarkdown(markdown: string): string {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
  }).use(katexPlugin);

  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const info = token.info.trim();
    if (info === "mermaid") {
      return `<div class="mermaid">${escapeHtml(token.content)}</div>`;
    }
    return defaultFence ? defaultFence(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  };

  return md.render(markdown);
}

function katexPlugin(md: MarkdownIt): void {
  md.inline.ruler.after("escape", "kdrg_math_inline", mathInline);
  md.block.ruler.after("blockquote", "kdrg_math_block", mathBlock, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });

  md.renderer.rules.kdrg_math_inline = (tokens, idx) =>
    renderKatex(tokens[idx].content, { displayMode: false });
  md.renderer.rules.kdrg_math_block = (tokens, idx) =>
    `<p class="kdrg-math-block">${renderKatex(tokens[idx].content, { displayMode: true })}</p>\n`;
}

function mathInline(state: InlineState, silent: boolean): boolean {
  if (state.src[state.pos] !== "$" || state.src[state.pos + 1] === "$") {
    return false;
  }

  let marker = state.pos + 1;
  while (true) {
    marker = state.src.indexOf("$", marker);
    if (marker === -1) {
      return false;
    }
    if (state.src[marker - 1] !== "\\") {
      break;
    }
    marker += 1;
  }

  const content = state.src.slice(state.pos + 1, marker);
  if (!content.trim()) {
    return false;
  }

  if (!silent) {
    const token = state.push("kdrg_math_inline", "math", 0);
    token.content = content;
  }

  state.pos = marker + 1;
  return true;
}

function mathBlock(state: BlockState, startLine: number, endLine: number, silent: boolean): boolean {
  let start = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];
  const firstLine = state.src.slice(start, max);

  if (!firstLine.startsWith("$$")) {
    return false;
  }

  if (silent) {
    return true;
  }

  let content = firstLine.slice(2);
  let nextLine = startLine;
  const sameLineEnd = content.lastIndexOf("$$");

  if (sameLineEnd !== -1 && content.slice(sameLineEnd + 2).trim() === "") {
    content = content.slice(0, sameLineEnd);
  } else {
    const lines = [content];
    while (nextLine + 1 < endLine) {
      nextLine += 1;
      start = state.bMarks[nextLine] + state.tShift[nextLine];
      max = state.eMarks[nextLine];
      const line = state.src.slice(start, max);
      const endMarker = line.lastIndexOf("$$");
      if (endMarker !== -1 && line.slice(endMarker + 2).trim() === "") {
        lines.push(line.slice(0, endMarker));
        break;
      }
      lines.push(line);
    }
    content = lines.join("\n");
  }

  const token = state.push("kdrg_math_block", "math", 0);
  token.block = true;
  token.content = content.trim();
  state.line = nextLine + 1;
  return true;
}

function renderKatex(content: string, options: katex.KatexOptions): string {
  return katex.renderToString(content, {
    ...options,
    throwOnError: false,
    strict: false,
    trust: false,
  });
}

function collectReferences(markdown: string, warnings: string[]): ReferenceStore {
  const counters: RefCounters = { graph: 0, table: 0 };
  const byVar = new Map<string, RefEntry>();

  for (const match of markdown.matchAll(SCAN_PATTERN)) {
    if (match[1]) {
      const kind = match[1] as RefKind;
      const varName = match[2] ?? "";
      const caption = match[3] ?? "";
      registerReference({ kind, varName, caption: caption.trim(), counters, byVar, warnings });
      continue;
    }

    const plot = parsePlotBlock(match[4], warnings);
    if (plot.caption && plot.varName) {
      registerReference({
        kind: "graph",
        varName: plot.varName,
        caption: plot.caption,
        counters,
        byVar,
        warnings,
      });
    }
  }

  return { byVar };
}

function registerReference({
  kind,
  varName,
  caption,
  counters,
  byVar,
  warnings,
}: {
  kind: RefKind;
  varName: string;
  caption: string;
  counters: RefCounters;
  byVar: Map<string, RefEntry>;
  warnings: string[];
}): void {
  if (byVar.has(varName)) {
    warnings.push(`Duplicate reference variable "${varName}" was ignored.`);
    return;
  }

  counters[kind] += 1;
  byVar.set(varName, {
    kind,
    varName,
    caption,
    number: counters[kind],
  });
}

function replaceReferencesOutsideCode(markdown: string, refs: ReferenceStore, warnings: string[]): string {
  const warned = new Set<string>();
  let inFence = false;

  return markdown
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }

      if (inFence) {
        return line;
      }

      return line.replace(/\$\{([A-Za-z_][\w-]*)\}/g, (match, varName) => {
        const entry = refs.byVar.get(varName);
        if (!entry) {
          if (!warned.has(varName)) {
            warnings.push(`Undefined reference "${varName}" was left as-is.`);
            warned.add(varName);
          }
          return match;
        }
        return formatRef(entry);
      });
    })
    .join("\n");
}

function numberHeadings(markdown: string): string {
  const counters = [0, 0, 0, 0, 0, 0];
  let inFence = false;

  return markdown
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }

      if (inFence) {
        return line;
      }

      const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (!match) {
        return line;
      }

      const level = match[1].length;
      const text = stripHeadingNumber(match[2].trim());
      if (isUnnumberedHeading(text)) {
        return `${match[1]} ${text}`;
      }

      if (level > 1 && counters[0] === 0) {
        counters[0] = 1;
      }

      counters[level - 1] += 1;
      for (let index = level; index < counters.length; index += 1) {
        counters[index] = 0;
      }

      for (let index = 0; index < level; index += 1) {
        if (counters[index] === 0) {
          counters[index] = 1;
        }
      }

      const number = counters.slice(0, level).join(".");
      return `${match[1]} ${number}. ${text}`;
    })
    .join("\n");
}

function stripHeadingNumber(text: string): string {
  return text.replace(/^\d+(?:\.\d+)*\.?\s+/, "");
}

function isUnnumberedHeading(text: string): boolean {
  return /^(参考文献|references)$/i.test(text);
}

function formatRef(entry: RefEntry): string {
  return `${entry.kind === "graph" ? "図" : "表"}${entry.number}`;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
