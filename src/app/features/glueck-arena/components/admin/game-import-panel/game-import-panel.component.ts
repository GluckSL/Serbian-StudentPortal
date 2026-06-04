import { Component, Input, OnChanges, SimpleChanges, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { NotificationService } from '../../../../../services/notification.service';
import * as XLSX from 'xlsx';

const GAME_TYPE_LABELS: Record<string, string> = {
  scramble_rush: 'Scramble Rush',
  sentence_builder: 'Sentence Builder',
  matching: 'Matching',
  flashcards: 'Flashcards',
  image_matching: 'Image Matching',
  gender_stack: 'Gender Stack',
  flapjugation: 'Flapjugation',
  whackawort: 'Whack-a-Wort',
  memory: 'Memory Game',
  jumbled_words: 'Jumbled Words',
  hangman: 'Hangman',
  multiple_choice: 'Multiple Choice',
  spin_wheel: 'Spin the Wheel',
  tap_boxes: 'Tap the Boxes',
  word_search: 'Word Search',
};

const IMPORT_COLUMNS: Record<string, { col: string; required?: boolean; note?: string }[]> = {
  scramble_rush: [
    { col: 'word', required: true },
    { col: 'hint' },
    { col: 'image_url' },
    { col: 'audio_url' },
    { col: 'difficulty_level' },
    { col: 'fall_duration_seconds' },
    { col: 'order' },
  ],
  sentence_builder: [
    { col: 'correct_sentence', required: true },
    { col: 'translation' },
    { col: 'sentence_audio_url' },
    { col: 'randomize_words' },
    { col: 'order' },
  ],
  matching: [
    { col: 'left', required: true },
    { col: 'right', required: true },
    { col: 'image_url' },
    { col: 'order' },
  ],
  flashcards: [
    { col: 'front', required: true },
    { col: 'back', required: true },
    { col: 'image_url' },
    { col: 'audio_url' },
    { col: 'order' },
  ],
  image_matching: [
    { col: 'question_index', required: true, note: 'groups pairs into one question' },
    { col: 'word', required: true },
    { col: 'hint' },
    { col: 'image_url', note: 'upload images in Questions tab after import' },
    { col: 'order' },
  ],
  memory: [
    { col: 'question_index', required: true, note: 'one board per index' },
    { col: 'word', required: true },
    { col: 'image_url', note: 'upload images in Questions tab after import' },
    { col: 'order' },
  ],
  gender_stack: [
    { col: 'word', required: true },
    { col: 'translation', required: true },
    { col: 'article_gender', required: true, note: 'der, die, or das' },
    { col: 'audio_url' },
    { col: 'order' },
  ],
  flapjugation: [
    { col: 'word', required: true, note: 'infinitive' },
    { col: 'translation', required: true },
    { col: 'ich', required: true },
    { col: 'du', required: true },
    { col: 'er_sie_es', required: true },
    { col: 'wir', required: true },
    { col: 'ihr', required: true },
    { col: 'sie_formal', required: true },
    { col: 'order' },
  ],
  whackawort: [
    { col: 'word', required: true },
    { col: 'translation', required: true },
    { col: 'category', required: true },
    { col: 'order' },
  ],
  jumbled_words: [
    { col: 'word', required: true },
    { col: 'hint', note: 'translation; required if no image_url' },
    { col: 'image_url' },
    { col: 'order' },
  ],
  hangman: [
    { col: 'word', required: true },
    { col: 'hint', required: true },
    { col: 'image_url' },
    { col: 'order' },
  ],
  multiple_choice: [
    { col: 'question_text', required: true },
    { col: 'option_1', required: true },
    { col: 'option_2', required: true },
    { col: 'option_3' },
    { col: 'option_4' },
    { col: 'correct_option', required: true, note: '1-based index of correct option' },
    { col: 'order' },
  ],
  spin_wheel: [
    { col: 'phrase', required: true, note: 'one wheel segment per row; min. 2 rows' },
    { col: 'order' },
  ],
  tap_boxes: [
    { col: 'phrase', required: true, note: 'one mystery box per row; min. 2 rows' },
    { col: 'order' },
  ],
  word_search: [
    { col: 'question_index', required: true, note: 'groups words into one puzzle' },
    { col: 'word', required: true, note: 'hidden word (min. 3 per puzzle)' },
    { col: 'order' },
  ],
};

@Component({
  selector: 'app-game-import-panel',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  template: `
    <div class="gip">
      <div class="gip__notice" *ngIf="!hasGameSetId">
        <mat-icon>info</mat-icon>
        <div>
          <strong>Save Game Details first</strong>
          <p>Import needs a saved game set. Fill in the form on the Game Details tab and click Save, then return here.</p>
        </div>
      </div>

      <ng-container *ngIf="hasGameSetId">
        <div class="gip__hero">
          <div class="gip__hero-text">
            <h3>Bulk import</h3>
            <p>Download a CSV template for <strong>{{ gameTypeLabel }}</strong>, fill it in Excel or Google Sheets, then upload for validation before importing.</p>
          </div>
          <span class="gip__badge">{{ gameTypeLabel }}</span>
        </div>

        <div class="gip__columns" *ngIf="columnGuide.length">
          <h4>Expected columns</h4>
          <div class="gip__column-chips">
            <span *ngFor="let c of columnGuide" class="gip__col" [class.gip__col--req]="c.required">
              {{ c.col }}<span *ngIf="c.required">*</span>
              <small *ngIf="c.note">{{ c.note }}</small>
            </span>
          </div>
        </div>

        <div class="gip__steps">
          <div class="gip__step">
            <span class="gip__step-num">1</span>
            <button mat-stroked-button (click)="downloadTemplate()">
              <mat-icon>download</mat-icon> Download template
            </button>
          </div>
          <div class="gip__step">
            <span class="gip__step-num">2</span>
            <button mat-stroked-button (click)="fileInput.click()">
              <mat-icon>upload_file</mat-icon> Upload CSV / Excel
            </button>
            <input #fileInput type="file" accept=".csv,.xlsx,.xls" hidden (change)="onFile($event)">
            <span class="gip__file-name" *ngIf="fileName">{{ fileName }} ({{ rows.length }} rows)</span>
          </div>
          <div class="gip__step">
            <span class="gip__step-num">3</span>
            <button mat-raised-button color="primary"
              [disabled]="!rows.length || importing || !previewOk"
              (click)="commit()">
              <mat-icon>cloud_upload</mat-icon>
              Import {{ validCount || rows.length }} items
            </button>
          </div>
        </div>

        <mat-progress-bar *ngIf="importing || previewing" mode="indeterminate"></mat-progress-bar>

        <div class="gip__stats" *ngIf="rows.length && !previewing">
          <span class="gip__stat gip__stat--ok" *ngIf="previewOk"><mat-icon>check_circle</mat-icon> {{ validCount }} valid</span>
          <span class="gip__stat gip__stat--err" *ngIf="previewErrors.length"><mat-icon>error</mat-icon> {{ previewErrors.length }} errors</span>
        </div>

        <div class="gip__errors" *ngIf="previewErrors.length">
          <h4>Fix these before importing</h4>
          <ul>
            <li *ngFor="let e of previewErrors">{{ e }}</li>
          </ul>
        </div>

        <div class="gip__preview" *ngIf="previewRows.length && previewOk">
          <h4>Preview (first {{ previewRows.length }} items)</h4>
          <div class="gip__preview-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th *ngFor="let key of previewKeys">{{ key }}</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of previewRows; let i = index">
                  <td>{{ i + 1 }}</td>
                  <td *ngFor="let key of previewKeys">{{ formatCell(row, key) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <p class="gip__replace-note">
          <mat-icon>warning_amber</mat-icon>
          Import replaces all existing questions for this game set (does not append).
        </p>
      </ng-container>
    </div>
  `,
  styles: [`
    .gip { padding: 8px 0 24px; }
    .gip__notice {
      display: flex; gap: 14px; align-items: flex-start;
      background: linear-gradient(135deg, #e3f2fd, #f0f7ff);
      border: 1px solid #90caf9; border-radius: 14px;
      padding: 18px 20px; color: #0d47a1;
    }
    .gip__notice mat-icon { flex-shrink: 0; font-size: 28px; width: 28px; height: 28px; }
    .gip__notice p { margin: 6px 0 0; font-size: 14px; line-height: 1.5; opacity: .9; }
    .gip__hero {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
      margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0;
    }
    .gip__hero h3 { margin: 0 0 8px; font-size: 20px; color: #1e3a5f; font-weight: 600; }
    .gip__hero p { margin: 0; font-size: 14px; color: #64748b; line-height: 1.5; max-width: 520px; }
    .gip__badge {
      flex-shrink: 0; padding: 8px 14px; border-radius: 999px;
      background: linear-gradient(135deg, #405980, #5a7ab5);
      color: #fff; font-size: 13px; font-weight: 600;
    }
    .gip__columns { margin-bottom: 20px; }
    .gip__columns h4 { margin: 0 0 10px; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; color: #94a3b8; font-weight: 600; }
    .gip__column-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .gip__col {
      font-size: 12px; padding: 6px 10px; border-radius: 8px;
      background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0;
    }
    .gip__col--req { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; font-weight: 600; }
    .gip__col small { display: block; font-weight: 400; color: #64748b; margin-top: 2px; }
    .gip__steps {
      display: flex; flex-wrap: wrap; gap: 20px; align-items: center;
      padding: 20px; background: #f8fafc; border-radius: 14px; border: 1px solid #e2e8f0;
      margin-bottom: 16px;
    }
    .gip__step { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .gip__step-num {
      width: 26px; height: 26px; border-radius: 50%;
      background: #405980; color: #fff; font-size: 13px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
    }
    .gip__file-name { font-size: 13px; color: #64748b; }
    .gip__stats { display: flex; gap: 16px; margin: 12px 0; font-size: 14px; }
    .gip__stat { display: flex; align-items: center; gap: 6px; }
    .gip__stat--ok { color: #15803d; }
    .gip__stat--err { color: #b91c1c; }
    .gip__stat mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .gip__errors {
      background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px;
      padding: 14px 18px; margin: 12px 0; max-height: 200px; overflow: auto;
    }
    .gip__errors h4 { margin: 0 0 8px; font-size: 14px; color: #991b1b; }
    .gip__errors ul { margin: 0; padding-left: 20px; font-size: 13px; color: #b91c1c; }
    .gip__preview h4 { margin: 16px 0 8px; font-size: 14px; color: #1e3a5f; }
    .gip__preview-scroll {
      overflow: auto; max-height: 280px; border-radius: 10px;
      border: 1px solid #e2e8f0; background: #fff;
    }
    .gip__preview table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .gip__preview th, .gip__preview td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #f1f5f9; }
    .gip__preview th { background: #f8fafc; color: #64748b; font-weight: 600; position: sticky; top: 0; }
    .gip__replace-note {
      display: flex; align-items: center; gap: 8px; margin-top: 20px;
      font-size: 13px; color: #b45309; background: #fffbeb; padding: 10px 14px; border-radius: 10px;
    }
    .gip__replace-note mat-icon { font-size: 20px; width: 20px; height: 20px; }
  `]
})
export class GameImportPanelComponent implements OnChanges {
  @Input() gameSetId!: string;
  @Input() gameType?: string;
  @Output() imported = new EventEmitter<void>();

  rows: Record<string, unknown>[] = [];
  previewRows: Record<string, unknown>[] = [];
  previewErrors: string[] = [];
  previewOk = false;
  validCount = 0;
  importing = false;
  previewing = false;
  fileName = '';

  get hasGameSetId(): boolean {
    return !!String(this.gameSetId || '').trim();
  }

  get gameTypeLabel(): string {
    const gt = this.gameType || '';
    return GAME_TYPE_LABELS[gt] || gt || 'this game';
  }

  get columnGuide() {
    return IMPORT_COLUMNS[this.gameType || ''] || [];
  }

  get previewKeys(): string[] {
    if (!this.previewRows.length) return [];
    const keys = new Set<string>();
    this.previewRows.forEach(r => Object.keys(r).forEach(k => {
      if (!k.startsWith('_')) keys.add(k);
    }));
    return [...keys].slice(0, 8);
  }

  constructor(private svc: InteractiveGameService, private notify: NotificationService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['gameSetId'] || changes['gameType']) {
      this.rows = [];
      this.previewRows = [];
      this.previewErrors = [];
      this.previewOk = false;
      this.validCount = 0;
      this.fileName = '';
    }
  }

  formatCell(row: Record<string, unknown>, key: string): string {
    const v = row[key];
    if (v == null) return '—';
    if (Array.isArray(v)) return v.length ? `[${v.length} items]` : '—';
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 40);
    return String(v).slice(0, 60);
  }

  downloadTemplate() {
    if (!this.hasGameSetId) {
      this.notify.error('Save Game Details first.');
      return;
    }
    this.svc.adminImportTemplate(this.gameSetId, this.gameType).subscribe({
      next: (r) => {
        const template = r.template || [];
        if (!template.length) {
          this.notify.error('No template for this game type');
          return;
        }
        const ws = XLSX.utils.json_to_sheet(template);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Import');
        XLSX.writeFile(wb, `glueck-arena-${r.gameType || this.gameType}-import.csv`);
        this.notify.success('Template downloaded');
      },
      error: () => this.notify.error('Could not download template'),
    });
  }

  onFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.fileName = file.name;
    const reader = new FileReader();
    reader.onload = () => {
      const data = new Uint8Array(reader.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      this.rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];
      if (!this.rows.length) {
        this.notify.error('File has no data rows');
        return;
      }
      this.preview();
    };
    reader.readAsArrayBuffer(file);
  }

  preview() {
    this.previewing = true;
    this.svc.adminImportPreview(this.gameSetId, this.rows, undefined, this.gameType).subscribe({
      next: (r) => {
        this.previewing = false;
        this.previewRows = (r.preview || []) as Record<string, unknown>[];
        this.previewErrors = r.errors || [];
        this.previewOk = !!r.ok;
        this.validCount = r.validCount ?? this.previewRows.length;
        if (r.ok) {
          this.notify.success(`Ready to import ${this.validCount} items`);
        } else {
          this.notify.error(`${this.previewErrors.length} validation error(s) — fix your file`);
        }
      },
      error: () => {
        this.previewing = false;
        this.notify.error('Preview failed');
      },
    });
  }

  commit() {
    if (!this.previewOk) {
      this.notify.error('Fix validation errors before importing');
      return;
    }
    this.importing = true;
    this.svc.adminImportCommit(this.gameSetId, this.rows, undefined, this.gameType).subscribe({
      next: (r) => {
        this.importing = false;
        this.notify.success(`Imported ${r.imported} items`);
        this.rows = [];
        this.previewRows = [];
        this.previewOk = false;
        this.validCount = 0;
        this.fileName = '';
        this.imported.emit();
      },
      error: (err) => {
        this.importing = false;
        const msg = err?.error?.errors?.[0] || err?.error?.message || 'Import failed';
        this.notify.error(msg);
      },
    });
  }
}
