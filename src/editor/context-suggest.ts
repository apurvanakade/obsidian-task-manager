/**
 * Purpose:
 * - provide inline context suggestions after typing context:: or contexts:: in the editor.
 *
 * Responsibilities:
 * - detects trigger context and current query text at cursor position
 * - returns suggestions sourced from the configured Known Contexts setting
 * - inserts the selected context value into the active editor with normalized spacing
 *
 * Dependencies:
 * - Obsidian EditorSuggest APIs
 * - caller-provided known-contexts source (settings.knownContexts)
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

const TRIGGER_REGEX = /((?:context|contexts)::)(\s*)([@a-z0-9-]*)$/i;

type ContextSuggestion = {
  value: string;
};

export class ContextEditorSuggest extends EditorSuggest<ContextSuggestion> {
  private readonly getKnownContexts: () => string[];
  private triggerInfo: EditorSuggestTriggerInfo | null = null;
  private activeEditor: Editor | null = null;

  constructor(app: App, getKnownContexts: () => string[]) {
    super(app);
    this.getKnownContexts = getKnownContexts;
    this.setInstructions([
      {
        command: "Enter",
        purpose: "Insert context",
      },
      {
        command: "Esc",
        purpose: "Close suggestions",
      },
    ]);
  }

  onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
    const linePrefix = editor.getLine(cursor.line).slice(0, cursor.ch);
    const triggerMatch = linePrefix.match(TRIGGER_REGEX);
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

  getSuggestions(context: EditorSuggestContext): ContextSuggestion[] {
    const normalizedQuery = context.query.trim().toLowerCase();
    return this.getKnownContexts()
      .filter((value) => normalizedQuery.length === 0 || value.toLowerCase().includes(normalizedQuery))
      .map((value) => ({ value }));
  }

  renderSuggestion(value: ContextSuggestion, el: HTMLElement): void {
    el.createDiv({ text: value.value });
  }

  selectSuggestion(value: ContextSuggestion): void {
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
}
