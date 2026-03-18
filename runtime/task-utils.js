const TASK_LINE_REGEX = /^(\s*[-*+]\s+\[( |x|X)\]\s+)(.*)$/;

function extractTaskState(content, nextActionTag) {
  const lines = content.split(/\r?\n/);
  const taskState = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(TASK_LINE_REGEX);
    if (!match) {
      continue;
    }

    taskState.push({
      line: index,
      completed: match[2].toLowerCase() === "x",
      hasNextAction: lineHasTag(lines[index], nextActionTag)
    });
  }

  return taskState;
}

function findNewlyCompletedTask(previousState, nextState) {
  // Compare by original line number to detect a true unchecked -> checked transition.
  const previousByLine = new Map(previousState.map((task) => [task.line, task.completed]));

  for (const task of nextState) {
    const wasCompleted = previousByLine.get(task.line);
    if (wasCompleted === false && task.completed) {
      return task.line;
    }
  }

  return null;
}

function findDeletedTaggedTask(previousState, nextState) {
  // This catches the case where the tagged task was removed and no replacement tag exists yet.
  const previousTaggedTask = previousState.find((task) => task.hasNextAction);
  if (!previousTaggedTask) {
    return null;
  }

  const hasCurrentTaggedTask = nextState.some((task) => task.hasNextAction);
  if (hasCurrentTaggedTask) {
    return null;
  }

  const sameLineStillExists = nextState.some((task) => task.line === previousTaggedTask.line);
  if (sameLineStillExists) {
    return null;
  }

  return previousTaggedTask.line;
}

function findNextIncompleteTaskLine(lines, completedLine) {
  for (let index = completedLine + 1; index < lines.length; index += 1) {
    const match = lines[index].match(TASK_LINE_REGEX);
    if (match?.[2] === " ") {
      return index;
    }
  }

  return null;
}

function findPreviousIncompleteTaskLine(lines, referenceLine) {
  for (let index = Math.min(referenceLine - 1, lines.length - 1); index >= 0; index -= 1) {
    const match = lines[index].match(TASK_LINE_REGEX);
    if (match?.[2] === " ") {
      return index;
    }
  }

  return findFirstIncompleteTaskLine(lines);
}

function findFirstIncompleteTaskLine(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(TASK_LINE_REGEX);
    if (match?.[2] === " ") {
      return index;
    }
  }

  return null;
}

function stripNextActionTags(lines, nextActionTag) {
  return lines.map((line) => {
    // Only strip from task lines so plain prose tags remain untouched.
    if (!lineHasTag(line, nextActionTag) || !line.match(TASK_LINE_REGEX)) {
      return line;
    }

    return line.replace(getTagReplaceRegex(nextActionTag), "");
  });
}

function addNextActionTag(lines, targetLine, nextActionTag) {
  const nextLines = [...lines];
  const targetLineContent = nextLines[targetLine];
  if (!lineHasTag(targetLineContent, nextActionTag)) {
    nextLines[targetLine] = `${targetLineContent} ${nextActionTag}`;
  }

  return nextLines.join("\n");
}

function lineHasTag(line, nextActionTag) {
  return getTagPresenceRegex(nextActionTag).test(line);
}

function getTagPresenceRegex(nextActionTag) {
  return new RegExp(`(^|\\s)${escapeRegExp(nextActionTag)}(?=$|\\s)`);
}

function getTagReplaceRegex(nextActionTag) {
  return new RegExp(`\\s+${escapeRegExp(nextActionTag)}(?=$|\\s)`, "g");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  extractTaskState,
  findNewlyCompletedTask,
  findDeletedTaggedTask,
  findNextIncompleteTaskLine,
  findPreviousIncompleteTaskLine,
  findFirstIncompleteTaskLine,
  stripNextActionTags,
  addNextActionTag
};