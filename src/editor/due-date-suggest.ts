import {
  App,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
} from "obsidian";

type DueDateSuggestion = {
  value: string;
  label: string;
};

const LOOKAHEAD_DAYS = 30;

export class DueDateEditorSuggest extends EditorSuggest<DueDateSuggestion> {
  private triggerInfo: EditorSuggestTriggerInfo | null = null;
  private activeEditor: Editor | null = null;

  constructor(app: App) {
    super(app);
    this.setInstructions([
      {
        command: "Enter",
        purpose: "Insert date",
      },
      {
        command: "Esc",
        purpose: "Close suggestions",
      },
    ]);
  }

  onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
    const linePrefix = editor.getLine(cursor.line).slice(0, cursor.ch);
    const triggerMatch = linePrefix.match(/due::\s*([0-9-]*)$/i);
    if (!triggerMatch) {
      this.triggerInfo = null;
      this.activeEditor = null;
      return null;
    }

    const query = triggerMatch[1] ?? "";
    const startCh = linePrefix.length - query.length;
    const trigger: EditorSuggestTriggerInfo = {
      start: { line: cursor.line, ch: startCh },
      end: cursor,
      query,
    };

    this.triggerInfo = trigger;
    this.activeEditor = editor;
    return trigger;
  }

  getSuggestions(context: EditorSuggestContext): DueDateSuggestion[] {
    const normalizedQuery = context.query.trim();
    return this.buildSuggestions().filter((suggestion) => {
      return normalizedQuery.length === 0 || suggestion.value.startsWith(normalizedQuery);
    });
  }

  renderSuggestion(value: DueDateSuggestion, el: HTMLElement): void {
    el.createDiv({ text: value.value });
    el.createEl("small", { text: value.label });
  }

  selectSuggestion(value: DueDateSuggestion): void {
    if (!this.activeEditor || !this.triggerInfo) {
      return;
    }

    this.activeEditor.replaceRange(value.value, this.triggerInfo.start, this.triggerInfo.end);
    this.close();
  }

  close(): void {
    super.close();
    this.triggerInfo = null;
    this.activeEditor = null;
  }

  private buildSuggestions(): DueDateSuggestion[] {
    const today = startOfDay(new Date());
    const suggestions: DueDateSuggestion[] = [];

    for (let offset = 0; offset <= LOOKAHEAD_DAYS; offset += 1) {
      const date = addDays(today, offset);
      suggestions.push({
        value: formatDate(date),
        label: this.getRelativeLabel(offset),
      });
    }

    return suggestions;
  }

  private getRelativeLabel(offset: number): string {
    if (offset === 0) {
      return "Today";
    }

    if (offset === 1) {
      return "Tomorrow";
    }

    return `In ${offset} days`;
  }
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
