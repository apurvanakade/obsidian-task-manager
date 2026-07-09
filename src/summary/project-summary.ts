/**
 * Purpose:
 * - generate a markdown Project Summary file from configured project folders.
 *
 * Responsibilities:
 * - scans Projects, Waiting, Someday-Maybe, and Completed folders
 * - renders depth-aware project tables with one folder column per nesting level
 * - groups active projects into priority subsections
 * - creates or overwrites the destination markdown file without merge prompts
 *
 * Dependencies:
 * - Obsidian vault/file APIs and normalized plugin settings
 *
 * Side Effects:
 * - reads markdown files and writes the project summary file to the vault
 */
import { App, TFile } from "obsidian";
import { TaskManagerSettings } from "../settings/settings-utils";
import { readFilePriority } from "../tasks/file-priority";
import { isExcludedSummaryFile, isInFolder, overwriteSummaryFile, resolveSummaryFile } from "./summary-file-io";

const MARKDOWN_EXTENSION_REGEX = /\.md$/i;

type ProjectSummarySection = {
  title: string;
  projects: ProjectSummaryEntry[];
};

type ProjectPriorityBuckets = {
  priority1: ProjectSummaryEntry[];
  priority2: ProjectSummaryEntry[];
  priority3: ProjectSummaryEntry[];
};

type ProjectSummaryEntry = {
  file: TFile;
  priority: number;
  folderSegments: string[];
};

type RenderableProjectRow = {
  folderSegments: string[];
  projectDisplayName: string;
  projectPath: string;
  priority: number;
};

type TableCell = {
  value: string;
  rowSpan: number;
};

export async function writeProjectSummary(
  app: App,
  settings: TaskManagerSettings,
  summaryFilePath: string,
): Promise<string> {
  const sections = await buildProjectSummarySections(app, settings);
  const summaryContent = renderProjectSummary(sections, settings.dashboardHideKeywords);
  const summaryFile = await resolveSummaryFile(app, summaryFilePath);
  await overwriteSummaryFile(app, summaryFile, summaryContent);
  return summaryFilePath;
}

async function buildProjectSummarySections(app: App, settings: TaskManagerSettings): Promise<ProjectSummarySection[]> {
  const sectionSources = [
    { title: "Projects", rootPath: settings.projectsFolder },
    { title: "Waiting", rootPath: settings.waitingProjectsFolder },
    { title: "Someday-Maybe", rootPath: settings.somedayMaybeProjectsFolder },
    { title: "Completed", rootPath: settings.completedProjectsFolder },
  ];

  const sections: ProjectSummarySection[] = [];
  for (const source of sectionSources) {
    sections.push({
      title: source.title,
      projects: await collectProjectsForFolder(app, source.rootPath, settings),
    });
  }

  return sections;
}

async function collectProjectsForFolder(
  app: App,
  folderPath: string,
  settings: TaskManagerSettings,
): Promise<ProjectSummaryEntry[]> {
  if (!folderPath) {
    return [];
  }

  const files = app.vault.getMarkdownFiles().filter((file) =>
    isInFolder(file.path, folderPath) && !isExcludedSummaryFile(file.path, settings),
  );
  const entries: ProjectSummaryEntry[] = [];

  for (const file of files) {
    const content = await app.vault.read(file);
    const relativePath = file.path.slice(folderPath.length + 1);
    const relativeSegments = relativePath.split("/");
    entries.push({
      file,
      priority: readFilePriority(content),
      folderSegments: relativeSegments.slice(0, -1),
    });
  }

  return entries.sort((left, right) => left.file.path.localeCompare(right.file.path));
}

function renderProjectSummary(sections: ProjectSummarySection[], hideKeywords: string): string {
  const lines: string[] = ["# Project Summary", ""];

  for (const section of sections) {
    lines.push(`## ${section.title}`, "");
    if (section.projects.length === 0) {
      lines.push("No projects.", "");
      continue;
    }

    if (section.title === "Projects") {
      appendPriorityProjectSections(lines, section.projects, hideKeywords);
    } else {
      appendProjectTable(lines, section.projects, hideKeywords);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function appendPriorityProjectSections(
  lines: string[],
  projects: ProjectSummaryEntry[],
  hideKeywords: string,
): void {
  const buckets = splitProjectsByPriority(projects);
  appendPrioritySection(lines, "Priority 1", buckets.priority1, hideKeywords);
  appendPrioritySection(lines, "Priority 2", buckets.priority2, hideKeywords);
  appendPrioritySection(lines, "Priority 3", buckets.priority3, hideKeywords);
}

function appendPrioritySection(
  lines: string[],
  title: string,
  projects: ProjectSummaryEntry[],
  hideKeywords: string,
): void {
  lines.push(`### ${title}`, "");
  if (projects.length === 0) {
    lines.push("No projects.", "");
    return;
  }

  appendProjectTable(lines, projects, hideKeywords);
  lines.push("");
}

function splitProjectsByPriority(projects: ProjectSummaryEntry[]): ProjectPriorityBuckets {
  const buckets: ProjectPriorityBuckets = {
    priority1: [],
    priority2: [],
    priority3: [],
  };

  for (const project of projects) {
    if (project.priority === 1) {
      buckets.priority1.push(project);
      continue;
    }

    if (project.priority === 2) {
      buckets.priority2.push(project);
      continue;
    }

    buckets.priority3.push(project);
  }

  return buckets;
}

function appendProjectTable(
  lines: string[],
  projects: ProjectSummaryEntry[],
  hideKeywords: string,
): void {
  const rows = projects.map((project) => ({
    folderSegments: project.folderSegments.map((segment) => formatDisplayName(segment, hideKeywords)),
    projectDisplayName: formatDisplayName(project.file.name.replace(MARKDOWN_EXTENSION_REGEX, ""), hideKeywords),
    projectPath: project.file.path,
    priority: project.priority,
  }));
  const maxDepth = Math.max(0, ...rows.map((row) => row.folderSegments.length));
  const folderCellsByRow = buildFolderCells(rows, maxDepth);

  lines.push("<table>");
  lines.push("  <thead>");
  lines.push("    <tr>");
  for (let depth = 0; depth < maxDepth; depth += 1) {
    lines.push(`      <th>Folder ${depth + 1}</th>`);
  }
  lines.push("      <th>Project</th>");
  lines.push("      <th>Priority</th>");
  lines.push("    </tr>");
  lines.push("  </thead>");
  lines.push("  <tbody>");

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    lines.push("    <tr>");
    for (let depth = 0; depth < maxDepth; depth += 1) {
      const cell = folderCellsByRow[rowIndex][depth];
      if (cell === null) {
        continue;
      }

      if (cell.rowSpan > 1) {
        lines.push(`      <td rowspan="${cell.rowSpan}">${escapeHtml(cell.value)}</td>`);
      } else {
        lines.push(`      <td>${escapeHtml(cell.value)}</td>`);
      }
    }
    lines.push(`      <td>${buildInternalLinkHtml(row.projectDisplayName, row.projectPath)}</td>`);
    lines.push(`      <td>${row.priority}</td>`);
    lines.push("    </tr>");
  }

  lines.push("  </tbody>");
  lines.push("</table>");
}

function buildFolderCells(
  rows: RenderableProjectRow[],
  maxDepth: number,
): Array<Array<TableCell | null>> {
  const cells = rows.map(() => Array<TableCell | null>(maxDepth).fill(null));

  for (let depth = 0; depth < maxDepth; depth += 1) {
    let rowIndex = 0;
    while (rowIndex < rows.length) {
      const value = rows[rowIndex].folderSegments[depth];
      if (value === undefined) {
        cells[rowIndex][depth] = { value: "", rowSpan: 1 };
        rowIndex += 1;
        continue;
      }

      const prefix = rows[rowIndex].folderSegments.slice(0, depth + 1);
      let rowSpan = 1;
      let nextIndex = rowIndex + 1;
      while (nextIndex < rows.length && prefixesEqual(rows[nextIndex].folderSegments, prefix, depth + 1)) {
        rowSpan += 1;
        nextIndex += 1;
      }

      cells[rowIndex][depth] = { value, rowSpan };
      for (let skipIndex = rowIndex + 1; skipIndex < nextIndex; skipIndex += 1) {
        cells[skipIndex][depth] = null;
      }

      rowIndex = nextIndex;
    }
  }

  return cells;
}

function prefixesEqual(segments: string[], prefix: string[], length: number): boolean {
  if (segments.length < length) {
    return false;
  }

  for (let index = 0; index < length; index += 1) {
    if (segments[index] !== prefix[index]) {
      return false;
    }
  }

  return true;
}

function formatDisplayName(name: string, hideKeywords: string): string {
  const keywords = hideKeywords
    .split(",")
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);

  if (keywords.length === 0) {
    return name;
  }

  let result = name;
  for (const keyword of keywords) {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escapedKeyword, "gi"), "");
  }

  result = result.replace(/\s+/g, " ").trim();
  return result || name;
}

function buildInternalLinkHtml(displayName: string, filePath: string): string {
  const escapedPath = escapeHtml(filePath);
  const escapedName = escapeHtml(displayName);
  return `<a class="internal-link" data-href="${escapedPath}" href="${escapedPath}">${escapedName}</a>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
