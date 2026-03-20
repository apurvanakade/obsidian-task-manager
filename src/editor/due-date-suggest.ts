/**
 * Purpose:
 * - provide inline date suggestions after typing due:: or created:: in the editor.
 *
 * Responsibilities:
 * - detects trigger context and current query text at cursor position
 * - returns date suggestions from shared date-suggestion generation
 * - supports matching by ISO date and natural-language labels
 * - inserts selected YYYY-MM-DD value into the active editor with normalized spacing
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

class DateFieldEditorSuggest extends EditorSuggest<DateSuggestion> {
  private readonly fieldName: string;
  private readonly suggestionFactory: () => DateSuggestion[];
  private triggerInfo: EditorSuggestTriggerInfo | null = null;
  private activeEditor: Editor | null = null;
  private triggerRegex: RegExp;

  constructor(app: App, fieldName: string, suggestionFactory: () => DateSuggestion[]) {
    super(app);
    this.fieldName = fieldName;
    this.suggestionFactory = suggestionFactory;
    this.triggerRegex = buildTriggerRegex(this.fieldName);
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
    const triggerMatch = linePrefix.match(this.triggerRegex);
    if (!triggerMatch) {
      this.triggerInfo = null;
      this.activeEditor = null;
      return null;
    }

    const query = triggerMatch[3] ?? "";
    const typedWhitespace = triggerMatch[2] ?? "";
    const startCh = linePrefix.length - typedWhitespace.length - query.length;
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

    this.activeEditor.replaceRange(` ${value.value}`, this.triggerInfo.start, this.triggerInfo.end);
    this.close();
  }

  close(): void {
    super.close();
    this.triggerInfo = null;
    this.activeEditor = null;
  }

  private buildSuggestions(): DateSuggestion[] {
    return this.suggestionFactory();
  }
}

const dueSuggestionFactory = createDailySuggestionFactory();

export class DueDateEditorSuggest extends DateFieldEditorSuggest {
  constructor(app: App) {
    super(app, "due", dueSuggestionFactory);
  }
}

export class CreatedDateEditorSuggest extends DateFieldEditorSuggest {
  constructor(app: App) {
    super(app, "created", createTodaySuggestionFactory());
  }
}

function buildTriggerRegex(fieldName: string): RegExp {
  const escapedFieldName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(${escapedFieldName}::)(\\s*)([a-z0-9-]*)$`, "i");
}

function createDailySuggestionFactory(): () => DateSuggestion[] {
  let cachedSuggestions: DateSuggestion[] | null = null;
  let cachedSuggestionsDate = "";

  return () => {
    const today = new Date().toISOString().slice(0, 10);
    if (cachedSuggestions !== null && cachedSuggestionsDate === today) {
      return cachedSuggestions;
    }

    cachedSuggestions = buildDateSuggestions(DEFAULT_LOOKAHEAD_DAYS);
    cachedSuggestionsDate = today;
    return cachedSuggestions;
  };
}

function createTodaySuggestionFactory(): () => DateSuggestion[] {
  let cachedSuggestion: DateSuggestion[] | null = null;
  let cachedSuggestionDate = "";

  return () => {
    const today = new Date().toISOString().slice(0, 10);
    if (cachedSuggestion !== null && cachedSuggestionDate === today) {
      return cachedSuggestion;
    }

    cachedSuggestion = [
      {
        value: today,
        label: "Today",
        searchText: `${today} today`,
      },
    ];
    cachedSuggestionDate = today;
    return cachedSuggestion;
  };
}
