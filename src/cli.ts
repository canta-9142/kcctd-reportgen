import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface, type Interface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { exportReport } from "./exporter.js";
import {
  createReportFolderName,
  createReportBlock,
  extractReportBlock,
  findProjectRoot,
  formatDate,
  readJsonIfExists,
  resolveReportDir,
  sanitizeFilePart,
  syncReportBlock,
  validateResubmittedOn,
} from "./files.js";

const CONFIG_FILE = "kdrg.config.json";

export type UserConfig = {
  grade?: string;
  studentNumber?: string;
  name?: string;
};

export type Report = {
  year: number;
  themeId: string;
  title: string;
  teachers: string[];
  startedOn: string;
  endedOn: string;
  submittedOn: string;
  resubmittedOn: string;
  grade: string;
  studentNumber: string;
  group: string;
  name: string;
  partners: string[];
  comments: string;
};

type CliOptions = {
  force: boolean;
  keepHtml: boolean;
};

export async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;

  switch (command) {
    case "config":
      await runConfig();
      break;
    case "init":
      await runInit(rest);
      break;
    case "export":
      await runExport(rest);
      break;
    case "-h":
    case "--help":
    case undefined:
      printHelp();
      break;
    default:
      throw new Error(`Unknown command: ${command}\n\nRun "kdrg --help" for usage.`);
  }
}

async function runConfig(): Promise<void> {
  const projectRoot = await findProjectRoot(process.cwd());
  const configPath = path.join(projectRoot, CONFIG_FILE);
  const current = ((await readJsonIfExists(configPath)) ?? {}) as UserConfig;

  const rl = createInterface({ input, output });
  try {
    const grade = await ask(rl, "学年", current.grade);
    const studentNumber = await ask(rl, "出席番号", current.studentNumber);
    const name = await ask(rl, "氏名", current.name);

    await writeFile(
      configPath,
      `${JSON.stringify({ grade, studentNumber, name }, null, 2)}\n`,
      "utf8",
    );
    console.log(`Saved ${path.relative(process.cwd(), configPath) || configPath}`);
  } finally {
    rl.close();
  }
}

async function runInit(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const projectRoot = await findProjectRoot(process.cwd());
  const configPath = path.join(projectRoot, CONFIG_FILE);
  const config = ((await readJsonIfExists(configPath)) ?? {}) as UserConfig;

  const rl = createInterface({ input, output });
  try {
    const now = new Date();
    const themeId = await askRequired(rl, "テーマ番号 (例: T1A1)");
    const title = await ask(rl, "実験題目", "");
    const teachersText = await ask(rl, "担当教員名 (カンマ区切り)", "");
    const startedOn = await askExperimentStartDate(rl, formatDate(now));
    const endedOn = await ask(rl, "実験終了日 (YYYY-MM-DD)", startedOn);
    const group = await ask(rl, "実験班", "");
    const partnersText = await ask(rl, "共同実験者名 (カンマ区切り)", "");
    const comments = await ask(rl, "コメント欄", "");
    const reportFolderName = createReportFolderName(startedOn, themeId);
    const year = Number(startedOn.slice(0, 4));

    const report: Report = {
      year,
      themeId,
      title,
      teachers: splitList(teachersText),
      startedOn,
      endedOn,
      submittedOn: "",
      resubmittedOn: "",
      grade: config.grade ?? "",
      studentNumber: config.studentNumber ?? "",
      group,
      name: config.name ?? "",
      partners: splitList(partnersText),
      comments,
    };

    const reportDir = path.join(projectRoot, "reports", reportFolderName);
    await ensureNewDirectory(reportDir, options.force);

    const indexPath = path.join(reportDir, "index.md");

    await writeFile(indexPath, `${createReportBlock(report)}\n${createInitialMarkdown()}`, "utf8");

    console.log(`Created ${path.relative(projectRoot, reportDir)}`);
  } finally {
    rl.close();
  }
}

async function runExport(args: string[]): Promise<void> {
  const folderArg = args[0];
  if (!folderArg || folderArg.startsWith("-")) {
    throw new Error("Usage: kdrg export <folder-name-or-absolute-path> [--options]");
  }

  const options = parseOptions(args.slice(1));
  const projectRoot = await findProjectRoot(process.cwd());
  const reportDir = await resolveReportDir(projectRoot, folderArg);

  const indexPath = path.join(reportDir, "index.md");
  const indexSource = await readFile(indexPath, "utf8");
  const report = extractReportBlock(indexSource);
  if (!report) {
    throw new Error(`kdrg report block not found in index.md: ${indexPath}`);
  }
  const resubmittedOn = validateResubmittedOn(report.resubmittedOn);

  const today = formatDate(new Date());
  const updatedReport = normalizeReport(report, today, resubmittedOn);
  await writeFile(indexPath, syncReportBlock(indexSource, updatedReport), "utf8");

  const outputDir = path.join(reportDir, "output");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(
    outputDir,
    `${sanitizeFilePart(updatedReport.year)}_${sanitizeFilePart(updatedReport.themeId)}_${sanitizeFilePart(updatedReport.name)}.pdf`,
  );

  await exportReport({
    projectRoot,
    reportDir,
    indexPath,
    report: updatedReport,
    outputPath,
    keepHtml: options.keepHtml === true,
  });

  console.log(`Exported ${path.relative(projectRoot, outputPath)}`);
}

function normalizeReport(
  report: Partial<Report>,
  today: string,
  resubmittedOn: string,
): Report {
  return {
    year: report.year ?? new Date().getFullYear(),
    themeId: report.themeId ?? "",
    title: report.title ?? "",
    teachers: Array.isArray(report.teachers) ? report.teachers : [],
    startedOn: report.startedOn ?? "",
    endedOn: report.endedOn ?? "",
    submittedOn: report.submittedOn || today,
    resubmittedOn,
    grade: report.grade ?? "",
    studentNumber: report.studentNumber ?? "",
    group: report.group ?? "",
    name: report.name ?? "",
    partners: Array.isArray(report.partners) ? report.partners : [],
    comments: report.comments ?? "",
  };
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    force: false,
    keepHtml: false,
  };

  for (const arg of args) {
    if (arg === "--force") {
      options.force = true;
    } else if (arg === "--keep-html") {
      options.keepHtml = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

async function ask(rl: Interface, label: string, defaultValue = ""): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await rl.question(`${label}${suffix}: `);
  return answer.trim() || defaultValue || "";
}

async function askRequired(rl: Interface, label: string, defaultValue = ""): Promise<string> {
  while (true) {
    const answer = await ask(rl, label, defaultValue);
    if (answer) {
      return answer;
    }
    console.log("必須項目です。");
  }
}

async function askExperimentStartDate(rl: Interface, defaultValue: string): Promise<string> {
  while (true) {
    const answer = await ask(rl, "実験開始日 (YYYY-MM-DD)", defaultValue);
    try {
      createReportFolderName(answer, "T");
      return answer;
    } catch {
      console.log("実在する日付を YYYY-MM-DD 形式で入力してください。");
    }
  }
}

async function ensureNewDirectory(dir: string, force: boolean): Promise<void> {
  try {
    await stat(dir);
    if (!force) {
      throw new Error(`Report folder already exists: ${dir}\nUse --force to reuse it.`);
    }
  } catch (error) {
    if (!isNodeError(error)) {
      throw error;
    }
    if (error.code === "ENOENT") {
      await mkdir(dir, { recursive: true });
      return;
    }
    if (!force) {
      throw error;
    }
  }

  await mkdir(dir, { recursive: true });
}

function splitList(text: string): string[] {
  return text
    .split(/[,\n、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createInitialMarkdown(): string {
  return `# 目的

# 原理

# 実験機器

# 実験方法

# 実験結果

# 考察

# 参考文献
`;
}

function printHelp(): void {
  console.log(`kdrg - KcctD ReportGen

Usage:
  kdrg config
  kdrg init [--force]
  kdrg export <folder-name-or-absolute-path> [--keep-html]

Examples:
  kdrg export 2026-06-T1A1
  kdrg export C:\\path\\to\\reports\\2026-06-T1A1 --keep-html
`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
