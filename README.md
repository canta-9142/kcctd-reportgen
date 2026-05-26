# KDRG (Kcct-D Report Generator)

KDRG (`kdrg`) は神戸高専電子工学科の実験レポートをMarkdownからPDFに自動生成するCLIツールです。

バージョン0.1.0では以下の機能をサポートしています:

1. `kdrg config`コマンドでプロジェクトの基本情報を設定
2. `kdrg init`コマンドでレポートのテンプレートを生成
3. `reports/<year>_<themeId>/index.md`に本文を記述
4. `kdrg export <folder-name>`コマンドでPDFを生成

## Install

### Node.jsのインストール

KDRGはNode.jsで動作します。<a href="https://nodejs.org/" target="_blank">公式サイト</a>からLTS版をインストールするか、以下のコマンドを実行してください:

```sh
# Debian/Ubuntu
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo bash -
sudo apt-get install -y nodejs

# macOS (Homebrew)
brew install node

# Windows (Winget)
winget install OpenJS.NodeJS.LTS
```

From GitHub:

```sh
npm install -g canta-9142/kcctd-reportgen
```

If Playwright has not installed Chromium yet, run:

```sh
npx playwright install chromium
```

## Development

KDRG is written in TypeScript and compiled to `dist/`.

```sh
npm run build
npm test
```

The executable at `bin/kdrg.js` loads the compiled entrypoint from `dist/src/cli.js`.

When installed directly from GitHub, npm runs the `prepare` script and builds the TypeScript sources before packing the executable package.

## File Layout

```text
project-root/
  kdrg.config.json
  reports/
    2026_T1A1/
      report.json
      index.md
      output/
        2026_T1A1_山田太郎.pdf
```

Report folders are named:

```text
<year>_<themeId>
```

PDF files are written to the report folder's `output/` directory:

```text
<year>_<themeId>_<name>.pdf
```

Intermediate HTML is deleted by default.

## Commands

```sh
kdrg config
```

Creates or updates `kdrg.config.json` in the project root.

```json
{
  "grade": "1",
  "studentNumber": "12",
  "name": "山田太郎"
}
```

```sh
kdrg init
```

Prompts for report metadata, then creates:

```text
reports/<year>_<themeId>/report.json
reports/<year>_<themeId>/index.md
```

```sh
kdrg export 2026_T1A1
```

Exports `reports/2026_T1A1/index.md`.

Absolute paths are also allowed:

```sh
kdrg export C:\path\to\reports\2026_T1A1
```

Options:

```sh
kdrg export 2026_T1A1 --keep-html
kdrg export 2026_T1A1 --no-index-sync
```

`--keep-html` keeps `cover.html`, `body.html`, and `compiled.md` in `output/`.

By default, export syncs the current `report.json` into a generated metadata block at the top of `index.md`. Use `--no-index-sync` to skip that write.

If `report.json.submittedOn` is empty, export fills it with the export date. `resubmittedOn` is always kept empty by the program.

## `report.json`

```json
{
  "year": 2026,
  "themeId": "T1A1",
  "title": "I-V特性の測定",
  "teacher": "高専先生",
  "startedOn": "2026-05-20",
  "endedOn": "2026-05-20",
  "submittedOn": "",
  "resubmittedOn": "",
  "grade": "1",
  "studentNumber": "12",
  "group": "3",
  "name": "山田太郎",
  "partners": ["佐藤花子"],
  "comments": ""
}
```

## Markdown Body

Write headings without manual numbers:

```md
# 目的

# 原理

# 実験機器

# 実験方法

# 実験結果

# 考察

# 参考文献
```

Heading numbers are generated during export. `参考文献` is not numbered.

## Captions and References

Declare figure and table captions with HTML comments:

```md
<!-- graph: a1: I-V特性 -->
<!-- table: parts: 使用器具一覧 -->
```

They render as:

```text
図1 I-V特性
表1 使用器具一覧
```

Reference them in text with `${var}`:

```md
${a1}に測定結果を示す。
```

Undefined references are left as-is and reported as warnings.

## Plot Blocks

Use a `plot` code fence. Metadata and CSV are separated by `---`.

````md
```plot
caption: I-V特性
var: a1
x:
  label: 電圧
  unit: V
  log: false
y:
  label: 電流
  unit: A
  log: false
---
x,y
0,0
1,0.02
2,0.04
```
````

`caption`, `var`, `x`, and `y` are optional. If both `caption` and `var` are present, the plot is registered as a graph and a figure number is added below the plot.

CSV data must start with:

```csv
x,y
```

MVP supports one `x` series and one `y` series.

## Supported Rendering

- A4 portrait PDF
- Cover page based on `report.json`
- Body page numbers starting after the cover
- Mermaid code fences
- TeX math via KaTeX
- Markdown tables
- Plot blocks
