const {
  addNextActionTag,
  findFirstIncompleteTaskLine,
  findNextIncompleteTaskLine,
  findPreviousIncompleteTaskLine,
  stripNextActionTags
} = require("./task-utils");

function isInProjectsFolder(filePath, projectsFolder) {
  return filePath === projectsFolder || filePath.startsWith(`${projectsFolder}/`);
}

async function applyCompletionRules(context) {
  const {
    file,
    content,
    completedLine,
    settings,
    readFile,
    writeFileContent,
    setFileStatus,
    setTaskState,
    extractTaskState
  } = context;

  const lines = content.split(/\r?\n/);
  const nextTaskLine = findNextIncompleteTaskLine(lines, completedLine);
  const cleanedLines = stripNextActionTags(lines, settings.nextActionTag);
  let updatedContent = cleanedLines.join("\n");

  if (nextTaskLine !== null) {
    updatedContent = addNextActionTag(cleanedLines, nextTaskLine, settings.nextActionTag);
  }

  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  await setFileStatus(file, nextTaskLine === null ? "completed" : "todo");
  const refreshedContent = await readFile(file);
  setTaskState(file.path, extractTaskState(refreshedContent, settings.nextActionTag));
}

async function applyDeletedTagRules(context) {
  const {
    file,
    content,
    deletedTaggedTaskLine,
    settings,
    readFile,
    writeFileContent,
    setFileStatus,
    setTaskState,
    extractTaskState
  } = context;

  const lines = content.split(/\r?\n/);
  const cleanedLines = stripNextActionTags(lines, settings.nextActionTag);
  const previousTaskLine = findPreviousIncompleteTaskLine(cleanedLines, deletedTaggedTaskLine);

  if (previousTaskLine === null) {
    await setFileStatus(file, "completed");
    const refreshedContent = await readFile(file);
    setTaskState(file.path, extractTaskState(refreshedContent, settings.nextActionTag));
    return;
  }

  const updatedContent = addNextActionTag(cleanedLines, previousTaskLine, settings.nextActionTag);
  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  await setFileStatus(file, "todo");
  const refreshedContent = await readFile(file);
  setTaskState(file.path, extractTaskState(refreshedContent, settings.nextActionTag));
}

async function reconcileFile(context) {
  const {
    file,
    settings,
    readFile,
    writeFileContent,
    setFileStatus,
    setTaskState,
    extractTaskState
  } = context;

  const content = await readFile(file);
  const lines = content.split(/\r?\n/);
  const cleanedLines = stripNextActionTags(lines, settings.nextActionTag);
  const firstIncompleteTaskLine = findFirstIncompleteTaskLine(cleanedLines);
  let updatedContent = cleanedLines.join("\n");
  let nextStatus = "completed";

  if (firstIncompleteTaskLine !== null) {
    updatedContent = addNextActionTag(cleanedLines, firstIncompleteTaskLine, settings.nextActionTag);
    nextStatus = "todo";
  }

  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  await setFileStatus(file, nextStatus);
  const refreshedContent = await readFile(file);
  setTaskState(file.path, extractTaskState(refreshedContent, settings.nextActionTag));
}

async function initializeProjectsFolder(context) {
  const {
    settings,
    getMarkdownFiles,
    reconcileOneFile
  } = context;

  const files = getMarkdownFiles().filter((file) => isInProjectsFolder(file.path, settings.projectsFolder));
  for (const file of files) {
    await reconcileOneFile(file);
  }

  return files.length;
}

module.exports = {
  applyCompletionRules,
  applyDeletedTagRules,
  initializeProjectsFolder,
  reconcileFile,
  isInProjectsFolder
};