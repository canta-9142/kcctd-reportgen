import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { PDFDocument } from "pdf-lib";
import { prepareMarkdown, renderMarkdown } from "./markdown.js";
import { formatDisplayDate } from "./files.js";
import type { Report } from "./cli.js";

const require = createRequire(import.meta.url);

type PdfOptions = Parameters<Page["pdf"]>[0];

const CSS_PIXELS_PER_MM = 96 / 25.4;
const BODY_PRINTABLE_HEIGHT_MM = 297 - 20 - 18;

export type ExportReportOptions = {
  projectRoot: string;
  reportDir: string;
  indexPath: string;
  report: Report;
  outputPath: string;
  keepHtml: boolean;
};

export async function exportReport({
  indexPath,
  report,
  outputPath,
  keepHtml,
}: ExportReportOptions): Promise<void> {
  const source = await readFile(indexPath, "utf8");
  const prepared = prepareMarkdown(source);
  const renderedBodyContent = renderMarkdown(
    prepared.markdown,
    pathToFileURL(`${path.dirname(indexPath)}${path.sep}`).href,
  );
  const bodyContent = await inlineLocalImages(renderedBodyContent);
  const coverHtml = buildCoverHtml(report);
  const bodyHtml = buildBodyHtml(bodyContent);
  const outputDir = path.dirname(outputPath);
  await mkdir(outputDir, { recursive: true });

  if (keepHtml) {
    await writeFile(path.join(outputDir, "cover.html"), coverHtml, "utf8");
    await writeFile(path.join(outputDir, "body.html"), bodyHtml, "utf8");
    await writeFile(path.join(outputDir, "compiled.md"), prepared.markdown, "utf8");
  }

  for (const warning of prepared.warnings) {
    console.warn(`Warning: ${warning}`);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const coverPdf = await renderPdfPage(browser, coverHtml, {
      printBackground: true,
      format: "A4",
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    const bodyPdf = await renderPdfPage(browser, bodyHtml, {
      printBackground: true,
      format: "A4",
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        '<div style="font-size:10px;width:100%;text-align:center;color:#222;"><span class="pageNumber"></span></div>',
      margin: { top: "20mm", right: "20mm", bottom: "18mm", left: "20mm" },
    }, BODY_PRINTABLE_HEIGHT_MM);

    await writeFile(outputPath, await mergePdfs([coverPdf, bodyPdf]));
  } catch (error) {
    if (error instanceof Error && /Executable doesn't exist|browserType.launch/i.test(error.message)) {
      throw new Error(
        `${error.message}\n\nPlaywright browser is missing. Run "npx playwright install chromium" and retry.`,
      );
    }
    throw error;
  } finally {
    await browser.close();
  }
}

async function inlineLocalImages(html: string): Promise<string> {
  const sources = Array.from(html.matchAll(/<img\b[^>]*\bsrc="(file:[^"]+)"/g), (match) => match[1]);
  let result = html;

  for (const source of new Set(sources)) {
    const imagePath = fileURLToPath(source);
    const extension = path.extname(imagePath).toLowerCase();
    const mimeType =
      extension === ".svg"
        ? "image/svg+xml"
        : extension === ".jpg" || extension === ".jpeg"
          ? "image/jpeg"
          : extension === ".gif"
            ? "image/gif"
            : extension === ".webp"
              ? "image/webp"
              : "image/png";
    const dataUrl = `data:${mimeType};base64,${(await readFile(imagePath)).toString("base64")}`;
    result = result.replaceAll(source, dataUrl);
  }

  return result;
}

async function renderPdfPage(
  browser: Browser,
  html: string,
  pdfOptions: PdfOptions,
  printableHeightMm?: number,
): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await page
      .waitForFunction(
        () => (window as unknown as { __kdrgReady?: boolean }).__kdrgReady === true,
        null,
        { timeout: 10000 },
      )
      .catch(() => {});
    await page.evaluate(() => document.fonts.ready);

    if (printableHeightMm !== undefined) {
      const tableHeights = await page.locator("main table").evaluateAll((tables) =>
        tables.map((table) => table.getBoundingClientRect().height),
      );
      const printableHeightPx = printableHeightMm * CSS_PIXELS_PER_MM;
      tableHeights.forEach((height, index) => {
        if (height > printableHeightPx) {
          console.warn(
            `Warning: 表${index + 1}の高さ (${(height / CSS_PIXELS_PER_MM).toFixed(1)}mm) がページの印刷可能領域 (${printableHeightMm}mm) を超えています。`,
          );
        }
      });
    }

    return await page.pdf(pdfOptions);
  } finally {
    await page.close();
  }
}

async function mergePdfs(pdfBytesList: Buffer[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const pdfBytes of pdfBytesList) {
    const source = await PDFDocument.load(pdfBytes);
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) {
      merged.addPage(page);
    }
  }
  return await merged.save();
}

function buildCoverHtml(report: Report): string {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(report.title || "実験報告書")}</title>
  <style>${baseStyles()}</style>
  <style>
    @page { size: A4; margin: 0; }
    body { margin: 0; }
    .cover-page {
      box-sizing: border-box;
      width: 210mm;
      min-height: 297mm;
      padding: 26mm 24mm 20mm;
      display: flex;
      flex-direction: column;
      color: #111;
    }
    .cover-title {
      font-family: var(--font-heading);
      font-size: 22pt;
      font-weight: 700;
      text-align: center;
      border-bottom: 1px solid #222;
      padding-bottom: 5mm;
      margin: 0 0 21mm;
    }
    .cover-fields {
      width: 100%;
      border-collapse: collapse;
      font-size: 12pt;
      line-height: 1.75;
    }
    .cover-fields th {
      width: 34mm;
      white-space: nowrap;
      font-weight: 400;
      text-align: justify;
      text-align-last: justify;
      vertical-align: top;
      padding: 1.5mm 2mm 1.5mm 0;
    }
    .cover-fields td {
      min-height: 8mm;
      padding: 1.5mm 0;
      vertical-align: top;
    }
    .cover-spacer td,
    .cover-spacer th {
      padding-top: 8mm;
    }
    .name-list {
      white-space: pre-line;
      min-height: 22mm;
    }
    .comment-box {
      margin-top: 14mm;
      border-top: 1px solid #222;
      min-height: 42mm;
      padding-top: 3mm;
    }
    .comment-title {
      font-family: var(--font-heading);
      font-size: 11pt;
      margin-bottom: 2mm;
    }
  </style>
</head>
<body>
  <section class="cover-page">
    <h1 class="cover-title">電子工学科 実験報告書</h1>
    <table class="cover-fields">
      <tbody>
        ${coverRow("実験題目", report.title)}
        ${coverRow("担当教員", (report.teachers ?? []).join(", "), "", "name-list")}
        ${coverRow("実験開始日", formatDisplayDate(report.startedOn))}
        ${coverRow("実験終了日", formatDisplayDate(report.endedOn))}
        ${coverRow("提出日", formatDisplayDate(report.submittedOn))}
        ${coverRow("再提出日", formatDisplayDate(report.resubmittedOn))}
        ${coverRow("学年", report.grade, "cover-spacer")}
        ${coverRow("出席番号", report.studentNumber)}
        ${coverRow("実験班", report.group)}
        ${coverRow("氏名", report.name)}
        ${coverRow("共同実験者名", (report.partners ?? []).join(", "), "", "name-list")}
      </tbody>
    </table>
    <div class="comment-box">
      <div class="comment-title">コメント欄</div>
      <div>${escapeHtml(report.comments ?? "")}</div>
    </div>
  </section>
  <script>window.__kdrgReady = true;</script>
</body>
</html>`;
}

function buildBodyHtml(content: string): string {
  const mermaidScript = readPackageFile("mermaid/dist/mermaid.min.js");
  const katexCss = readPackageFile("katex/dist/katex.min.css");

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <style>${baseStyles()}</style>
  <style>${katexCss}</style>
  <style>
    @page { size: A4; }
    body {
      color: #111;
      font-size: 10.5pt;
      line-height: 1.65;
      margin: 0;
    }
    h1, h2, h3, h4, h5, h6 {
      font-family: var(--font-heading);
      line-height: 1.35;
      break-after: avoid;
      margin: 1.2em 0 0.55em;
    }
    h1 { font-size: 15pt; }
    h2 { font-size: 13pt; }
    h3 { font-size: 11.5pt; }
    main > p {
      text-indent: 1em;
      margin: 0.45em 0;
    }
    main > p.kdrg-math-block {
      text-indent: 0;
    }
    .kdrg-math-inline > .katex {
      font-size: 1em;
    }
    li > p,
    blockquote > p {
      text-indent: 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      border-top: 2px solid #111;
      border-bottom: 1px solid #333;
      margin: 0.2em 0 1.2em;
      font-size: 9.5pt;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    thead {
      display: table-row-group;
    }
    th, td {
      border: 0;
      padding: 0.35em 0.5em;
    }
    tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    th + th,
    td + td {
      border-left: 1px solid #777;
    }
    th {
      font-family: var(--font-heading);
      border-bottom: 1px solid #333;
      text-align: left;
    }
    .kdrg-code-block {
      margin: 0.8em 0 1.2em;
      border: 1px solid #3c3c3c;
      background: #1e1e1e;
      color: #d4d4d4;
      break-inside: avoid;
    }
    .kdrg-code-header {
      min-height: 2.1em;
      padding: 0.45em 0.9em 0.4em;
      border-bottom: 1px solid #3c3c3c;
      background: #252526;
      color: #cccccc;
      font-family: var(--font-code);
      font-size: 8pt;
      line-height: 1.25;
      text-transform: lowercase;
    }
    .kdrg-code-block pre {
      display: flex;
      margin: 0;
      padding: 0.8em 0;
      white-space: pre-wrap;
      font-family: var(--font-code);
      font-variant-ligatures: common-ligatures contextual;
      font-feature-settings: "liga" 1, "calt" 1;
      font-size: 9pt;
      line-height: 1.45;
    }
    .kdrg-line-numbers {
      flex: 0 0 auto;
      min-width: 3.5em;
      padding: 0 0.9em;
      border-right: 1px solid #3c3c3c;
      color: #858585;
      text-align: right;
      user-select: none;
    }
    code {
      font-family: var(--font-code);
      font-size: 0.95em;
    }
    .kdrg-code-block pre code {
      display: block;
      flex: 1 1 auto;
      min-width: 0;
      padding: 0 1em;
      color: #d4d4d4;
      overflow-wrap: anywhere;
      font-variant-ligatures: inherit;
      font-feature-settings: inherit;
    }
    .hljs-comment,
    .hljs-quote { color: #6a9955; }
    .hljs-keyword,
    .hljs-selector-tag,
    .hljs-literal { color: #569cd6; }
    .hljs-string,
    .hljs-regexp,
    .hljs-attribute { color: #ce9178; }
    .hljs-number { color: #b5cea8; }
    .hljs-title,
    .hljs-section { color: #dcdcaa; }
    .hljs-type,
    .hljs-built_in { color: #4ec9b0; }
    .hljs-variable,
    .hljs-template-variable,
    .hljs-params,
    .hljs-property { color: #9cdcfe; }
    .hljs-meta,
    .hljs-symbol,
    .hljs-bullet { color: #c586c0; }
    figure {
      margin: 1.1em auto 1.4em;
      text-align: center;
      break-inside: avoid;
    }
    main img {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 0 auto;
    }
    figcaption,
    .kdrg-caption {
      font-family: var(--font-heading);
      font-size: 9.5pt;
      text-align: center;
      margin: 0.45em 0 1em;
    }
    .kdrg-table-caption {
      margin-bottom: 0.2em;
    }
    .kdrg-graph-caption {
      margin-top: 0.3em;
    }
    .kdrg-plot-svg {
      display: block;
      max-width: 100%;
      margin: 0 auto;
    }
    .kdrg-plot-svg .grid {
      stroke: #d6d6d6;
      stroke-width: 1;
    }
    .kdrg-plot-svg .tick,
    .kdrg-plot-svg .plot-frame {
      stroke: #111;
      stroke-width: 1.2;
      fill: none;
    }
    .kdrg-plot-svg .plot-line {
      fill: none;
      stroke: #145ea8;
      stroke-width: 2;
    }
    .kdrg-plot-svg .plot-point {
      fill: #fff;
      stroke: #145ea8;
      stroke-width: 2;
    }
    .kdrg-plot-svg text {
      font-family: var(--font-heading);
      fill: #111;
    }
    .kdrg-plot-svg .tick-label {
      font-size: 12px;
    }
    .kdrg-plot-svg .axis-label {
      font-size: 15px;
    }
    .mermaid {
      text-align: center;
      break-inside: avoid;
    }
  </style>
</head>
<body>
  <main>${content}</main>
  <script>${mermaidScript}</script>
  <script>
    (async () => {
      try {
        if (window.mermaid) {
          window.mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
          await window.mermaid.run({ querySelector: ".mermaid" });
        }
      } finally {
        window.__kdrgReady = true;
      }
    })();
  </script>
</body>
</html>`;
}

function coverRow(label: string, value: unknown, rowClass = "", cellClass = ""): string {
  return `<tr class="${rowClass}"><th>${escapeHtml(label)}：</th><td class="${cellClass}">${escapeHtml(value ?? "")}</td></tr>`;
}

function baseStyles(): string {
  return `
    :root {
      --font-body: "Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "MS Mincho", serif;
      --font-heading: "Noto Sans CJK JP", "Noto Sans JP", "Yu Gothic", "YuGothic", "Meiryo", sans-serif;
      --font-code: "Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace;
    }
    * { box-sizing: border-box; }
    body { font-family: var(--font-body); }
  `;
}

function readPackageFile(specifier: string): string {
  try {
    return require("node:fs").readFileSync(require.resolve(specifier), "utf8");
  } catch {
    return "";
  }
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
