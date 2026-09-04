import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareMarkdown, renderMarkdown } from "../src/markdown.js";
import { parsePlotBlock, renderPlot } from "../src/plot.js";
import {
  createReportFolderName,
  extractReportBlock,
  formatDisplayDate,
  syncReportBlock,
  validateResubmittedOn,
} from "../src/files.js";

test("numbers headings and keeps references unnumbered", () => {
  const result = prepareMarkdown(`# 目的

## 詳細

# 参考文献
`);

  assert.match(result.markdown, /# 1\. 目的/);
  assert.match(result.markdown, /## 1\.1\. 詳細/);
  assert.match(result.markdown, /# 参考文献/);
});

test("uses the experiment start year and month in report folder names", () => {
  assert.equal(createReportFolderName("2026-06-05", "T1A1"), "2026-06-T1A1");
  assert.throws(() => createReportFolderName("2026-02-30", "T1A1"), /Invalid experiment start date/);
});

test("formats report dates with Japanese year, month, and day markers", () => {
  assert.equal(formatDisplayDate("2026-06-05"), "2026年6月5日");
  assert.equal(formatDisplayDate(""), "");
});

test("reads the resubmission date from index.md and synchronizes the report block", () => {
  const source = `<!-- kdrg-report:start
{
  "resubmittedOn": "2026-06-12"
}
kdrg-report:end -->

# 目的
`;
  const indexReport = extractReportBlock(source);
  const resolved = validateResubmittedOn(indexReport?.resubmittedOn);
  const synced = syncReportBlock(source, { ...indexReport, resubmittedOn: resolved });

  assert.equal(resolved, "2026-06-12");
  assert.match(synced, /"resubmittedOn": "2026-06-12"/);
});

test("rejects an invalid resubmission date in index.md", () => {
  assert.throws(
    () => validateResubmittedOn("2026/06/12"),
    /Use YYYY-MM-DD/,
  );
  assert.throws(
    () => validateResubmittedOn("2026-02-30"),
    /Use YYYY-MM-DD/,
  );
});

test("renders caption comments and variable references", () => {
  const result = prepareMarkdown(`\${a1}に結果を示す。

<!-- graph: a1: I-V特性 -->

<!-- table: parts: 使用器具一覧 -->
`);

  assert.match(result.markdown, /図1に結果を示す。/);
  assert.match(result.markdown, /図1 I-V特性/);
  assert.match(result.markdown, /表1 使用器具一覧/);
});

test("registers plot caption and var as a graph reference", () => {
  const result = prepareMarkdown(`\${a1}に結果を示す。

\`\`\`plot
caption: I-V特性
var: a1
x:
  label: 電圧
  unit: V
y:
  label: 電流
  unit: A
---
x,y
0,0
1,0.02
\`\`\`
`);

  assert.match(result.markdown, /図1に結果を示す。/);
  assert.match(result.markdown, /<figure class="kdrg-plot"/);
  assert.match(result.markdown, /<figcaption>図1 I-V特性<\/figcaption>/);
});

test("accepts trailing commas in plot CSV header and rows", () => {
  const warnings: string[] = [];
  const plot = parsePlotBlock(`---
x,y,
0,0,
1,0.02,
`, warnings);

  assert.deepEqual(plot.rows, [
    { x: 0, y: 0 },
    { x: 1, y: 0.02 },
  ]);
  assert.deepEqual(warnings, []);
});

test("supports plot axis start, end, and interval settings", () => {
  const warnings: string[] = [];
  const plot = parsePlotBlock(`x:
  label: 電圧
  unit: V
  start: 0
  end: 4
  interval: 2
y:
  label: 電流
  unit: A
  start: 0
  end: 0.04
  interval: 0.02
---
x,y
0,0
2,0.02
4,0.04
`, warnings);
  const html = renderPlot(plot);

  assert.equal(plot.x.start, 0);
  assert.equal(plot.x.end, 4);
  assert.equal(plot.x.interval, 2);
  assert.equal(plot.y.start, 0);
  assert.equal(plot.y.end, 0.04);
  assert.equal(plot.y.interval, 0.02);
  assert.match(html, />0<\/text>/);
  assert.match(html, />2<\/text>/);
  assert.match(html, />4<\/text>/);
  assert.match(html, />0.02<\/text>/);
  assert.deepEqual(warnings, []);
});

test("renders inline and block math with KaTeX", () => {
  const html = renderMarkdown(`Inline $E=mc^2$.

$$
f_0 = \\frac{1}{2\\pi\\sqrt{LC}}
$$
`);

  assert.match(html, /katex/);
  assert.match(html, /kdrg-math-inline/);
  assert.match(html, /kdrg-math-block/);
});

test("renders explicit Markdown links without linkifying bare URLs", () => {
  const html = renderMarkdown(`[資料](./assets/reference.pdf)

https://example.com
`, "file:///tmp/report/");

  assert.match(html, /<a href="file:\/\/\/tmp\/report\/assets\/reference\.pdf">資料<\/a>/);
  assert.doesNotMatch(html, /<a href="https:\/\/example\.com">/);
});

test("adds stable heading ids for page-local links", () => {
  const html = renderMarkdown(`# 1. 目的

[目的へ](#目的)

# 2. 目的
`);

  assert.match(html, /<h1 id="目的">1\. 目的<\/h1>/);
  assert.match(html, /<a href="#%E7%9B%AE%E7%9A%84">目的へ<\/a>/);
  assert.match(html, /<h1 id="目的-2">2\. 目的<\/h1>/);
});

test("renders fenced code with VS Code-style highlighting and line numbers", () => {
  const html = renderMarkdown(`\`\`\`typescript
const message: string = "Hello";
console.log(message);
\`\`\`
`);

  assert.match(html, /class="kdrg-code-block"/);
  assert.match(html, /class="kdrg-code-header"><span>typescript<\/span>/);
  assert.match(html, /class="kdrg-line-numbers"[^>]*>1\n2<\/span>/);
  assert.match(html, /class="hljs language-typescript"/);
  assert.match(html, /hljs-keyword/);
  assert.match(html, /hljs-string/);
});

test("escapes code when the fence language is unknown", () => {
  const html = renderMarkdown(`\`\`\`custom-language
<unsafe>& value
\`\`\`
`);

  assert.match(html, /&lt;unsafe&gt;&amp; value/);
});
