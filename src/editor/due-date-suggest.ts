import {
  App,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
} from "obsidian";
import {
  buildDateSuggestions,
  DateSuggestion,
  DEFAULT_LOOKAHEAD_DAYS,
} from "../date/date-suggestions";

export class DueDateEditorSuggest extends EditorSuggest<DateSuggestion> {
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
    const triggerMatch = linePrefix.match(/due::\s*([a-z0-9-]*)$/i);
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

  getSuggestions(context: EditorSuggestContext): DateSuggestion[] {
    const normalizedQuery = context.query.trim().toLowerCase();
    return this.buildSuggestions().filter((suggestion) => {
      return normalizedQuery.length === 0 || suggestion.searchText.includes(normalizedQuery);
    });
  }

  renderSuggestion(value: DateSuggestion, el: HTMLElement): void {
    el.createDiv({ text: value.value });
    el.createEl("small", { text: value.label });
  }

  selectSuggestion(value: DateSuggestion): void {
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

  private buildSuggestions(): DateSuggestion[] {
    return buildDateSuggestions(DEFAULT_LOOKAHEAD_DAYS);
  }
}
