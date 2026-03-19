/**
 * Purpose:
 * - provide inline due-date suggestions after typing due:: in the editor.
 *
 * Responsibilities:
 * - detects trigger context and current query text at cursor position
 * - returns date suggestions from shared date-suggestion generation
 * - supports matching by ISO date and natural-language labels
 * - inserts selected YYYY-MM-DD value into the active editor
 *
 * Dependencies:
 * - Obsidian EditorSuggest APIs
 * - shared date suggestion builder
 *
 * Side Effects:
 * - mutates active editor content on suggestion selection
 */
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
  private cachedSuggestions: DateSuggestion[] | null = null;
  private cachedSuggestionsDate = "";

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
    const today = new Date().toISOString().slice(0, 10);
    if (this.cachedSuggestions !== null && this.cachedSuggestionsDate === today) {
      return this.cachedSuggestions;
    }

    this.cachedSuggestions = buildDateSuggestions(DEFAULT_LOOKAHEAD_DAYS);
    this.cachedSuggestionsDate = today;
    return this.cachedSuggestions;
  }
}
