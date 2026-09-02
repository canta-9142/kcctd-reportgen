import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Report } from "./cli.js";

export async function readJsonIfExists(filePath: string): Promise<unknown | undefined> {
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (!isNodeError(error)) {
      throw error;
    }
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw new Error(`Failed to read JSON ${filePath}: ${error.message}`);
  }
}

export async function findProjectRoot(startDir: string): Promise<string> {
  let dir = path.resolve(startDir);
  while (true) {
    try {
      await stat(path.join(dir, "kdrg.config.json"));
      return dir;
    } catch (error) {
      if (!isNodeError(error)) {
        throw error;
      }
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.resolve(startDir);
    }
    dir = parent;
  }
}

export async function resolveReportDir(projectRoot: string, folderArg: string): Promise<string> {
  if (path.isAbsolute(folderArg)) {
    return folderArg;
  }

  const standard = path.join(projectRoot, "reports", folderArg);
  if (await exists(standard)) {
    return standard;
  }

  const direct = path.resolve(projectRoot, folderArg);
  if (await exists(direct)) {
    return direct;
  }

  return standard;
}

export function createReportBlock(report: Partial<Report>): string {
  return `<!-- kdrg-report:start
${JSON.stringify(report, null, 2)}
kdrg-report:end -->`;
}

export function extractReportBlock(source: string): Partial<Report> | undefined {
  const match = /<!--\s*kdrg-report:start\s*([\s\S]*?)\s*kdrg-report:end\s*-->/.exec(source);
  if (!match) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(match[1] ?? "") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("metadata must be a JSON object");
    }
    return parsed as Partial<Report>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse the kdrg report block in index.md: ${message}`);
  }
}

export function syncReportBlock(source: string, report: Partial<Report>): string {
  const block = createReportBlock(report);
  const pattern = /<!--\s*kdrg-report:start[\s\S]*?kdrg-report:end\s*-->\s*/;
  if (pattern.test(source)) {
    return source.replace(pattern, `${block}\n\n`);
  }
  return `${block}\n\n${source.replace(/^\uFEFF/, "")}`;
}

export function stripReportBlock(source: string): string {
  return source.replace(/<!--\s*kdrg-report:start[\s\S]*?kdrg-report:end\s*-->\s*/g, "");
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDisplayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }

  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`;
}

export function validateResubmittedOn(value: unknown): string {
  const normalized = normalizeOptionalDateValue(value, "index.md");

  if (normalized && !isValidIsoDate(normalized)) {
    throw new Error(
      `Invalid resubmittedOn "${normalized}". Use YYYY-MM-DD in index.md.`,
    );
  }

  return normalized;
}

export function createReportFolderName(startedOn: string, themeId: string): string {
  if (!isValidIsoDate(startedOn)) {
    throw new Error(`Invalid experiment start date "${startedOn}". Use YYYY-MM-DD.`);
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startedOn)!;
  return `${match[1]}-${match[2]}-${themeId}`;
}

export function sanitizeFilePart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "");
}

function normalizeOptionalDateValue(value: unknown, source: string): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid resubmittedOn in ${source}. Use a YYYY-MM-DD string.`);
  }
  return value.trim();
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (!isNodeError(error)) {
      throw error;
    }
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
