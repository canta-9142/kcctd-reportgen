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
  start?: number;
  end?: number;
  interval?: number;
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

  parseMeta(metaText, plot, warnings);
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

function parseMeta(metaText: string, plot: PlotBlock, warnings: string[]): void {
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
      } else if (key === "start" || key === "end" || key === "interval") {
        const parsed = parseOptionalNumber(value);
        if (parsed === undefined) {
          warnings.push(`Plot axis "${currentAxis}.${key}" was ignored because it is not numeric.`);
          continue;
        }
        plot[currentAxis][key] = parsed;
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

  const header = trimTrailingCsvCommas(lines[0] ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();
  if (header !== "x,y") {
    warnings.push('Plot CSV should start with "x,y".');
  }

  const rows: PlotRow[] = [];
  for (const [index, line] of lines.slice(1).entries()) {
    const [xText, yText] = trimTrailingCsvCommas(line)
      .split(",")
      .map((value) => value.trim());
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

function trimTrailingCsvCommas(line: string): string {
  return line.replace(/,+\s*$/, "");
}

function renderPlotSvg(plot: PlotBlock): string {
  const width = DEFAULT_WIDTH;
  const height = DEFAULT_HEIGHT;
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;
  const rows = filterRowsForScale(plot.rows, plot);
  const xDomain = makeDomain(rows.map((row) => row.x), plot.x);
  const yDomain = makeDomain(rows.map((row) => row.y), plot.y);
  const xScale = makeScale(xDomain, MARGIN.left, MARGIN.left + innerWidth, plot.x.log);
  const yScale = makeScale(yDomain, MARGIN.top + innerHeight, MARGIN.top, plot.y.log);

  const points = rows.map((row) => ({
    x: xScale(row.x),
    y: yScale(row.y),
  }));

  const polyline = points.map((point) => `${round(point.x)},${round(point.y)}`).join(" ");
  const xTicks = makeTicks(xDomain, plot.x);
  const yTicks = makeTicks(yDomain, plot.y);

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

function makeDomain(values: number[], axis: PlotAxis): [number, number] {
  const logScale = axis.log;
  const finite = values.filter((value) => Number.isFinite(value) && (!logScale || value > 0));
  const autoDomain = makeAutoDomain(finite, logScale);
  let start = isUsableAxisBound(axis.start, logScale) ? axis.start : autoDomain[0];
  let end = isUsableAxisBound(axis.end, logScale) ? axis.end : autoDomain[1];

  if (start === end) {
    if (logScale) {
      start /= 10;
      end *= 10;
    } else {
      start -= 1;
      end += 1;
    }
  }

  return [start, end];
}

function makeAutoDomain(values: number[], logScale: boolean): [number, number] {
  if (values.length === 0) {
    return logScale ? [1, 10] : [0, 1];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return logScale ? [min / 10, max * 10] : [min - 1, max + 1];
  }

  if (logScale) {
    return [min, max];
  }

  const padding = (max - min) * 0.08 || 1;
  return [min >= 0 ? 0 : min - padding, max <= 0 ? 0 : max + padding];
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

function makeTicks(domain: [number, number], axis: PlotAxis): number[] {
  if (axis.interval !== undefined && Number.isFinite(axis.interval) && axis.interval > 0) {
    return makeIntervalTicks(domain, axis.interval);
  }

  if (axis.log) {
    const start = Math.floor(Math.log10(domain[0]));
    const end = Math.ceil(Math.log10(domain[1]));
    return Array.from({ length: end - start + 1 }, (_value, index) => 10 ** (start + index));
  }

  const count = 5;
  const step = (domain[1] - domain[0]) / (count - 1 || 1);
  return Array.from({ length: count }, (_value, index) => domain[0] + step * index);
}

function makeIntervalTicks(domain: [number, number], interval: number): number[] {
  const [start, end] = domain;
  const direction = end >= start ? 1 : -1;
  const step = interval * direction;
  const epsilon = interval * 1e-9;
  const ticks: number[] = [];

  for (
    let current = start;
    direction > 0 ? current <= end + epsilon : current >= end - epsilon;
    current += step
  ) {
    ticks.push(roundTick(current));
    if (ticks.length >= 1000) {
      break;
    }
  }

  return ticks;
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

function parseOptionalNumber(value: string): number | undefined {
  const parsed = Number(cleanValue(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isUsableAxisBound(value: number | undefined, logScale: boolean): value is number {
  return value !== undefined && Number.isFinite(value) && (!logScale || value > 0);
}

function roundTick(value: number): number {
  return Number(value.toPrecision(12));
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
