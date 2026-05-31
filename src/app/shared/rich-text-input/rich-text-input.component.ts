import {
  Component,
  Input,
  Output,
  EventEmitter,
  forwardRef,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnChanges,
  SimpleChanges,
  ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { sanitizeQuestionHtml } from '../../pipes/safe-html.pipe';

/**
 * Lightweight rich-text editor for question fields.
 * Supports Bold, Italic and Highlight (yellow mark) via execCommand.
 * Stores and emits sanitized HTML; fully compatible with [(ngModel)].
 *
 * Usage:
 *   <app-rich-text-input [(ngModel)]="q.question" [placeholder]="'Your question...'"></app-rich-text-input>
 */
@Component({
  selector: 'app-rich-text-input',
  standalone: true,
  imports: [CommonModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => RichTextInputComponent),
      multi: true
    }
  ],
  template: `
    <div class="rte-wrapper" [class.rte-focused]="focused">
      <div class="rte-toolbar" (mousedown)="$event.preventDefault()">
        <button type="button" class="rte-btn" [class.rte-active]="isBold"
                (click)="execBold()" title="Bold (Ctrl+B)">
          <b>B</b>
        </button>
        <button type="button" class="rte-btn" [class.rte-active]="isItalic"
                (click)="execItalic()" title="Italic (Ctrl+I)">
          <i>I</i>
        </button>
        <button type="button" class="rte-btn rte-btn--highlight" [class.rte-active]="isHighlight"
                (click)="execHighlight()" title="Highlight">
          <span class="rte-hl-icon">H</span>
        </button>
        <button type="button" class="rte-btn rte-btn--clear" (click)="clearFormat()" title="Clear formatting">
          <span class="material-icons" style="font-size:14px;line-height:1">format_clear</span>
        </button>
      </div>
      <div
        #editor
        class="rte-editor"
        [class.rte-multiline]="multiline"
        [attr.data-placeholder]="placeholder"
        contenteditable="true"
        (input)="onEditorInput()"
        (focus)="onFocus()"
        (blur)="onBlur()"
        (keydown)="onKeydown($event)"
      ></div>
    </div>
  `,
  styles: [`
    .rte-wrapper {
      border: 1px solid #d1d5db;
      border-radius: 6px;
      overflow: hidden;
      transition: border-color .15s, box-shadow .15s;
      background: #fff;
    }
    .rte-wrapper.rte-focused {
      border-color: #4f46e5;
      box-shadow: 0 0 0 3px rgba(79,70,229,.12);
    }
    .rte-toolbar {
      display: flex;
      gap: 2px;
      padding: 4px 6px;
      border-bottom: 1px solid #e5e7eb;
      background: #f9fafb;
    }
    .rte-btn {
      min-width: 28px;
      height: 26px;
      padding: 0 6px;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      color: #374151;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background .1s, border-color .1s;
    }
    .rte-btn:hover { background: #e5e7eb; border-color: #d1d5db; }
    .rte-btn.rte-active { background: #dbeafe; border-color: #93c5fd; color: #1d4ed8; }
    .rte-btn--highlight .rte-hl-icon {
      background: #fef08a;
      color: #713f12;
      border-radius: 2px;
      padding: 1px 4px;
      font-weight: 700;
      font-size: 13px;
    }
    .rte-btn--highlight.rte-active .rte-hl-icon {
      background: #eab308;
      color: #fff;
    }
    .rte-editor {
      min-height: 38px;
      padding: 8px 10px;
      outline: none;
      font-size: 14px;
      line-height: 1.6;
      color: #111827;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .rte-editor.rte-multiline { min-height: 72px; }
    .rte-editor:empty::before {
      content: attr(data-placeholder);
      color: #9ca3af;
      pointer-events: none;
    }
    /* pass-through styling for rendered marks */
    .rte-editor mark { background: #fef08a; color: inherit; padding: 0 1px; border-radius: 2px; }
  `]
})
export class RichTextInputComponent implements ControlValueAccessor, AfterViewInit, OnChanges {
  @Input() placeholder = '';
  @Input() multiline = false;
  @Input() rows = 1;

  @ViewChild('editor') editorRef!: ElementRef<HTMLDivElement>;

  focused = false;
  isBold = false;
  isItalic = false;
  isHighlight = false;

  private _value = '';
  private _skipNextWrite = false;

  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  constructor(private cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    if (this._value) {
      this.editorRef.nativeElement.innerHTML = this._value;
    }
    // Derive multiline from rows
    if (this.rows > 1) this.multiline = true;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['rows'] && this.rows > 1) {
      this.multiline = true;
    }
  }

  // ── ControlValueAccessor ──────────────────────────────────────────────────

  writeValue(val: string | null | undefined): void {
    this._value = sanitizeQuestionHtml(val || '');
    if (this.editorRef?.nativeElement) {
      const el = this.editorRef.nativeElement;
      // Only update DOM when the value actually changed (avoids caret jump)
      if (el.innerHTML !== this._value) {
        this._skipNextWrite = true;
        el.innerHTML = this._value;
      }
    }
  }

  registerOnChange(fn: (v: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }

  setDisabledState(disabled: boolean): void {
    if (this.editorRef?.nativeElement) {
      this.editorRef.nativeElement.contentEditable = disabled ? 'false' : 'true';
    }
  }

  // ── Editor events ─────────────────────────────────────────────────────────

  onEditorInput(): void {
    if (this._skipNextWrite) { this._skipNextWrite = false; return; }
    const raw = this.editorRef.nativeElement.innerHTML;
    const cleaned = sanitizeQuestionHtml(raw);
    this._value = cleaned;
    this.onChange(cleaned);
    this.updateActiveStates();
  }

  onFocus(): void {
    this.focused = true;
    this.updateActiveStates();
  }

  onBlur(): void {
    this.focused = false;
    // Flush latest HTML so ngModel always has the value even if the last edit did not emit `input` (IME / browser quirks).
    if (this.editorRef?.nativeElement) {
      const raw = this.editorRef.nativeElement.innerHTML;
      const cleaned = sanitizeQuestionHtml(raw);
      this._value = cleaned;
      this.onChange(cleaned);
    }
    this.onTouched();
  }

  onKeydown(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); this.execBold(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); this.execItalic(); }
    // Prevent newlines in single-line mode
    if (!this.multiline && e.key === 'Enter') { e.preventDefault(); }
  }

  // ── Format commands ───────────────────────────────────────────────────────

  execBold(): void {
    this.editorRef.nativeElement.focus();
    document.execCommand('bold', false);
    this.onEditorInput();
  }

  execItalic(): void {
    this.editorRef.nativeElement.focus();
    document.execCommand('italic', false);
    this.onEditorInput();
  }

  execHighlight(): void {
    this.editorRef.nativeElement.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

    const range = sel.getRangeAt(0);

    // If selection is already inside a <mark>, unwrap it
    const ancestor = range.commonAncestorContainer;
    const markEl = this.closestMark(ancestor as Node);
    if (markEl) {
      const parent = markEl.parentNode!;
      while (markEl.firstChild) parent.insertBefore(markEl.firstChild, markEl);
      parent.removeChild(markEl);
    } else {
      const mark = document.createElement('mark');
      range.surroundContents(mark);
    }

    sel.removeAllRanges();
    this.onEditorInput();
  }

  clearFormat(): void {
    this.editorRef.nativeElement.focus();
    document.execCommand('removeFormat', false);
    this.onEditorInput();
  }

  private closestMark(node: Node): HTMLElement | null {
    let n: Node | null = node;
    while (n && n !== this.editorRef.nativeElement) {
      if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === 'MARK') {
        return n as HTMLElement;
      }
      n = n.parentNode;
    }
    return null;
  }

  private updateActiveStates(): void {
    this.isBold = document.queryCommandState('bold');
    this.isItalic = document.queryCommandState('italic');
    // Detect highlight by checking if selection is inside <mark>
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const node = sel.getRangeAt(0).commonAncestorContainer;
      this.isHighlight = !!this.closestMark(node);
    } else {
      this.isHighlight = false;
    }
    this.cdr.markForCheck();
  }
}
