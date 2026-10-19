import type { HistoryEntry } from './types';

export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private readonly limit: number;
  private readonly onChange: () => void;

  constructor(onChange: () => void, limit = 24) {
    this.onChange = onChange;
    this.limit = limit;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string {
    return this.undoStack[this.undoStack.length - 1]?.label ?? '';
  }

  get redoLabel(): string {
    return this.redoStack[this.redoStack.length - 1]?.label ?? '';
  }

  push(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.onChange();
  }

  undo(): string | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    entry.undo();
    this.redoStack.push(entry);
    this.onChange();
    return entry.label;
  }

  redo(): string | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    entry.redo();
    this.undoStack.push(entry);
    this.onChange();
    return entry.label;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange();
  }
}
