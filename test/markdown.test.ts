import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareMarkdown, renderMarkdown } from "../src/markdown.js";
import { parsePlotBlock, renderPlot } from "../src/plot.js";

test("numbers headings and keeps references unnumbered", () => {
  const result = prepareMarkdown(`# 目的

## 詳細

# 参考文献
`);

  assert.match(result.markdown, /# 1\. 目的/);
  assert.match(result.markdown, /## 1\.1\. 詳細/);
  assert.match(result.markdown, /# 参考文献/);
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
  assert.match(html, /kdrg-math-block/);
});
