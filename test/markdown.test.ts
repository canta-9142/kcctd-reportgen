import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareMarkdown, renderMarkdown } from "../src/markdown.js";

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

test("renders inline and block math with KaTeX", () => {
  const html = renderMarkdown(`Inline $E=mc^2$.

$$
f_0 = \\frac{1}{2\\pi\\sqrt{LC}}
$$
`);

  assert.match(html, /katex/);
  assert.match(html, /kdrg-math-block/);
});
