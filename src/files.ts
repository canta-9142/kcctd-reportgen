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

export function createReportBlock(report: Report): string {
  return `<!-- kdrg-report:start
${JSON.stringify(report, null, 2)}
kdrg-report:end -->`;
}

export function syncReportBlock(source: string, report: Report): string {
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

export function sanitizeFilePart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "");
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
