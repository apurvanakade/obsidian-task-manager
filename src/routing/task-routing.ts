import { App, Modal, TFile, TFolder } from "obsidian";
import { TaskManagerSettings } from "../settings/settings-utils";

export type RoutableStatus = "todo" | "completed" | "waiting" | "someday-maybe";

export function getDestinationRootForStatus(settings: TaskManagerSettings, status: RoutableStatus): string {
  switch (status) {
    case "todo":
      return settings.projectsFolder;
    case "completed":
      return settings.completedProjectsFolder;
    case "waiting":
      return settings.waitingProjectsFolder;
    case "someday-maybe":
      return settings.somedayMaybeProjectsFolder;
    default:
      return "";
  }
}

export function getTaskFolderRoots(settings: TaskManagerSettings): string[] {
  const roots = [
    settings.projectsFolder,
    settings.completedProjectsFolder,
    settings.waitingProjectsFolder,
    settings.somedayMaybeProjectsFolder,
  ].filter(Boolean);

  return [...new Set(roots)];
}

export function buildDestinationPath(file: TFile, destinationRoot: string, taskFolderRoots: string[]): string {
  const relativePath = getRelativeProjectPath(file.path, taskFolderRoots) ?? file.name;
  return joinPath(destinationRoot, relativePath);
}

export async function ensureParentFoldersExist(app: App, targetFilePath: string): Promise<void> {
  const parentPath = getParentPath(targetFilePath);
  if (!parentPath) {
    return;
  }

  const parts = parentPath.split("/").filter(Boolean);
  let currentPath = "";

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(currentPath);
    if (!existing) {
      await app.vault.createFolder(currentPath);
      continue;
    }

    if (existing instanceof TFile) {
      throw new Error(`Cannot create folder '${currentPath}' because a file already exists at that path.`);
    }
  }
}

export async function deleteEmptyParentFolders(app: App, protectedRoots: string[], sourceFilePath: string): Promise<void> {
  const protectedRootSet = new Set(protectedRoots);
  let currentPath = getParentPath(sourceFilePath);

  while (currentPath) {
    if (protectedRootSet.has(currentPath)) {
      return;
    }

    const entry = app.vault.getAbstractFileByPath(currentPath);
    if (!(entry instanceof TFolder)) {
      return;
    }

    const hasDescendants = app.vault
      .getAllLoadedFiles()
      .some((candidate) => candidate.path !== currentPath && candidate.path.startsWith(`${currentPath}/`));

    if (hasDescendants) {
      return;
    }

    await app.vault.delete(entry, true);
    currentPath = getParentPath(currentPath);
  }
}

export async function promptMergeOrSkip(app: App, sourcePath: string, destinationPath: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    class MergeConflictModal extends Modal {
      private resolved = false;

      onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        const title = document.createElement("h3");
        title.textContent = "File Already Exists";
        contentEl.appendChild(title);

        const message = document.createElement("p");
        message.textContent = "A destination file already exists. Choose how to proceed:";
        contentEl.appendChild(message);

        const sourceLabel = document.createElement("p");
        sourceLabel.textContent = `Source: ${sourcePath}`;
        contentEl.appendChild(sourceLabel);

        const destinationLabel = document.createElement("p");
        destinationLabel.textContent = `Destination: ${destinationPath}`;
        contentEl.appendChild(destinationLabel);

        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "8px";
        actions.style.marginTop = "12px";

        const mergeButton = document.createElement("button");
        mergeButton.textContent = "Merge";
        mergeButton.addEventListener("click", () => {
          this.resolved = true;
          resolve(true);
          this.close();
        });

        const skipButton = document.createElement("button");
        skipButton.textContent = "Do Nothing";
        skipButton.addEventListener("click", () => {
          this.resolved = true;
          resolve(false);
          this.close();
        });

        actions.appendChild(mergeButton);
        actions.appendChild(skipButton);
        contentEl.appendChild(actions);
      }

      onClose(): void {
        if (!this.resolved) {
          resolve(false);
        }
      }
    }

    new MergeConflictModal(app).open();
  });
}

function getRelativeProjectPath(filePath: string, taskFolderRoots: string[]): string | null {
  const matchingRoot = taskFolderRoots
    .filter((root) => filePath.startsWith(`${root}/`))
    .sort((left, right) => right.length - left.length)[0];

  if (!matchingRoot) {
    return null;
  }

  return filePath.slice(matchingRoot.length + 1);
}

function joinPath(root: string, childPath: string): string {
  const normalizedRoot = root.replace(/\/+$/g, "");
  const normalizedChild = childPath.replace(/^\/+/, "");
  return normalizedRoot ? `${normalizedRoot}/${normalizedChild}` : normalizedChild;
}

function getParentPath(path: string): string {
  const slashIndex = path.lastIndexOf("/");
  return slashIndex === -1 ? "" : path.slice(0, slashIndex);
}