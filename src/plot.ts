const DEFAULT_WIDTH = 680;
const DEFAULT_HEIGHT = 420;
const MARGIN = { top: 24, right: 28, bottom: 70, left: 82 };

export type RefKind = "graph" | "table";

export type RefEntry = {
  kind: RefKind;
  varName: string;
  caption: string;
  number: number;
};

export type PlotAxis = {
  label: string;
  unit: string;
  log: boolean;
};

export type PlotRow = {
  x: number;
  y: number;
};

export type PlotBlock = {
  caption: string;
  varName: string;
  x: PlotAxis;
  y: PlotAxis;
  rows: PlotRow[];
};

type PlotAxisName = "x" | "y";

export function parsePlotBlock(content: string, warnings: string[] = []): PlotBlock {
  const { metaText, csvText } = splitPlotContent(content);
  const plot: PlotBlock = {
    caption: "",
    varName: "",
    x: { label: "x", unit: "", log: false },
    y: { label: "y", unit: "", log: false },
    rows: [],
  };

  parseMeta(metaText, plot);
  plot.rows = parseCsv(csvText, warnings);
  return plot;
}

export function renderPlot(plot: PlotBlock, entry?: RefEntry): string {
  const svg = renderPlotSvg(plot);
  const caption = entry
    ? `<figcaption>図${entry.number} ${escapeHtml(entry.caption)}</figcaption>`
    : plot.caption
      ? `<figcaption>${escapeHtml(plot.caption)}</figcaption>`
      : "";

  return `<figure class="kdrg-plot" data-kdrg-type="graph">
${svg}
${caption}
</figure>`;
}

function splitPlotContent(content: string): { metaText: string; csvText: string } {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const delimiterIndex = lines.findIndex((line) => line.trim() === "---");
  if (delimiterIndex === -1) {
    return { metaText: "", csvText: content };
  }

  return {
    metaText: lines.slice(0, delimiterIndex).join("\n"),
    csvText: lines.slice(delimiterIndex + 1).join("\n"),
  };
}

function parseMeta(metaText: string, plot: PlotBlock): void {
  let currentAxis: PlotAxisName | "" = "";
  for (const rawLine of metaText.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "");
    if (!line.trim()) {
      continue;
    }

    const top = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (top && !/^\s/.test(line)) {
      const [, key = "", value = ""] = top;
      currentAxis = "";
      if (key === "caption") {
        plot.caption = cleanValue(value);
      } else if (key === "var") {
        plot.varName = cleanValue(value);
      } else if (key === "x" || key === "y") {
        currentAxis = key;
      }
      continue;
    }

    const nested = /^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (nested && currentAxis && plot[currentAxis]) {
      const [, key = "", value = ""] = nested;
      if (key === "label") {
        plot[currentAxis].label = cleanValue(value) || currentAxis;
      } else if (key === "unit") {
        plot[currentAxis].unit = cleanValue(value);
      } else if (key === "log") {
        plot[currentAxis].log = parseBoolean(value);
      }
    }
  }
}

function parseCsv(csvText: string, warnings: string[]): PlotRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const header = lines[0].replace(/\s+/g, "").toLowerCase();
  if (header !== "x,y") {
    warnings.push('Plot CSV should start with "x,y".');
  }

  const rows: PlotRow[] = [];
  for (const [index, line] of lines.slice(1).entries()) {
    const [xText, yText] = line.split(",").map((value) => value.trim());
    const x = Number(xText);
    const y = Number(yText);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      warnings.push(`Plot row ${index + 2} was skipped because x or y is not numeric.`);
      continue;
    }
    rows.push({ x, y });
  }
  return rows;
}

function renderPlotSvg(plot: PlotBlock): string {
  const width = DEFAULT_WIDTH;
  const height = DEFAULT_HEIGHT;
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;
  const rows = filterRowsForScale(plot.rows, plot);
  const xDomain = makeDomain(rows.map((row) => row.x), plot.x.log);
  const yDomain = makeDomain(rows.map((row) => row.y), plot.y.log);
  const xScale = makeScale(xDomain, MARGIN.left, MARGIN.left + innerWidth, plot.x.log);
  const yScale = makeScale(yDomain, MARGIN.top + innerHeight, MARGIN.top, plot.y.log);

  const points = rows.map((row) => ({
    x: xScale(row.x),
    y: yScale(row.y),
  }));

  const polyline = points.map((point) => `${round(point.x)},${round(point.y)}`).join(" ");
  const xTicks = makeTicks(xDomain, plot.x.log);
  const yTicks = makeTicks(yDomain, plot.y.log);

  return `<svg class="kdrg-plot-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(
    plot.caption || "plot",
  )}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#fff" />
  ${xTicks
    .map((tick) => {
      const x = xScale(tick);
      return `<line class="grid" x1="${round(x)}" y1="${MARGIN.top}" x2="${round(x)}" y2="${MARGIN.top + innerHeight}" />
  <line class="tick" x1="${round(x)}" y1="${MARGIN.top + innerHeight}" x2="${round(x)}" y2="${MARGIN.top + innerHeight + 6}" />
  <text class="tick-label" x="${round(x)}" y="${MARGIN.top + innerHeight + 24}" text-anchor="middle">${formatTick(
    tick,
  )}</text>`;
    })
    .join("\n  ")}
  ${yTicks
    .map((tick) => {
      const y = yScale(tick);
      return `<line class="grid" x1="${MARGIN.left}" y1="${round(y)}" x2="${MARGIN.left + innerWidth}" y2="${round(y)}" />
  <line class="tick" x1="${MARGIN.left - 6}" y1="${round(y)}" x2="${MARGIN.left}" y2="${round(y)}" />
  <text class="tick-label" x="${MARGIN.left - 12}" y="${round(y + 4)}" text-anchor="end">${formatTick(tick)}</text>`;
    })
    .join("\n  ")}
  <rect class="plot-frame" x="${MARGIN.left}" y="${MARGIN.top}" width="${innerWidth}" height="${innerHeight}" />
  ${points.length > 1 ? `<polyline class="plot-line" points="${polyline}" />` : ""}
  ${points
    .map(
      (point) =>
        `<circle class="plot-point" cx="${round(point.x)}" cy="${round(point.y)}" r="4" />`,
    )
    .join("\n  ")}
  <text class="axis-label x-label" x="${MARGIN.left + innerWidth / 2}" y="${height - 20}" text-anchor="middle">${escapeHtml(
    axisLabel(plot.x),
  )}</text>
  <text class="axis-label y-label" transform="translate(20 ${MARGIN.top + innerHeight / 2}) rotate(-90)" text-anchor="middle">${escapeHtml(
    axisLabel(plot.y),
  )}</text>
</svg>`;
}

function filterRowsForScale(rows: PlotRow[], plot: PlotBlock): PlotRow[] {
  return rows.filter((row) => (!plot.x.log || row.x > 0) && (!plot.y.log || row.y > 0));
}

function makeDomain(values: number[], logScale: boolean): [number, number] {
  const finite = values.filter((value) => Number.isFinite(value) && (!logScale || value > 0));
  if (finite.length === 0) {
    return logScale ? [1, 10] : [0, 1];
  }

  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    if (logScale) {
      min /= 10;
      max *= 10;
    } else {
      min -= 1;
      max += 1;
    }
  }

  if (logScale) {
    return [min, max];
  }

  const padding = (max - min) * 0.08 || 1;
  const lower = min >= 0 ? 0 : min - padding;
  const upper = max <= 0 ? 0 : max + padding;
  return [lower, upper];
}

function makeScale(
  domain: [number, number],
  rangeStart: number,
  rangeEnd: number,
  logScale: boolean,
): (value: number) => number {
  const [domainStart, domainEnd] = logScale ? domain.map((value) => Math.log10(value)) : domain;
  return (value) => {
    const current = logScale ? Math.log10(value) : value;
    const rate = (current - domainStart) / (domainEnd - domainStart || 1);
    return rangeStart + rate * (rangeEnd - rangeStart);
  };
}

function makeTicks(domain: [number, number], logScale: boolean): number[] {
  if (logScale) {
    const start = Math.floor(Math.log10(domain[0]));
    const end = Math.ceil(Math.log10(domain[1]));
    return Array.from({ length: end - start + 1 }, (_value, index) => 10 ** (start + index));
  }

  const count = 5;
  const step = (domain[1] - domain[0]) / (count - 1 || 1);
  return Array.from({ length: count }, (_value, index) => domain[0] + step * index);
}

function formatTick(value: number): string {
  if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)) {
    return value.toExponential(1);
  }
  return Number(value.toPrecision(4)).toString();
}

function axisLabel(axis: PlotAxis): string {
  return axis.unit ? `${axis.label || ""} [${axis.unit}]` : axis.label || "";
}

function cleanValue(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function parseBoolean(value: string): boolean {
  return /^(true|1|yes|on)$/i.test(cleanValue(value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
