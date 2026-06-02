import { Component, Input, OnChanges, SimpleChanges, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { NotificationService } from '../../../../../services/notification.service';
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-game-import-panel',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  template: `
    <div class="gip">
      <div class="gip__notice" *ngIf="!hasGameSetId">
        <mat-icon>info</mat-icon>
        <p>Save <strong>Game Details</strong> first. Import (CSV template and upload) is available after the game set is created.</p>
      </div>

      <ng-container *ngIf="hasGameSetId">
      <h3>Bulk import (CSV)</h3>
      <p class="gip__hint">Download template, fill rows, upload for preview, then commit.</p>
      <div class="gip__actions">
        <button mat-stroked-button (click)="downloadTemplate()"><mat-icon>download</mat-icon> Template</button>
        <button mat-stroked-button (click)="fileInput.click()"><mat-icon>upload_file</mat-icon> Upload CSV</button>
        <input #fileInput type="file" accept=".csv,.xlsx,.xls" hidden (change)="onFile($event)">
        <button mat-raised-button color="primary" [disabled]="!rows.length || importing" (click)="commit()">
          Import {{ rows.length }} rows
        </button>
      </div>
      <mat-progress-bar *ngIf="importing" mode="indeterminate"></mat-progress-bar>
      <div class="gip__errors" *ngIf="previewErrors.length">
        <p *ngFor="let e of previewErrors">{{ e }}</p>
      </div>
      <div class="gip__preview" *ngIf="previewRows.length">
        <p>Preview (first {{ previewRows.length }} valid rows)</p>
        <pre>{{ previewRows | json }}</pre>
      </div>
      </ng-container>
    </div>
  `,
  styles: [`
    .gip { padding: 16px 0; }
    .gip__notice {
      display: flex; gap: 12px; align-items: flex-start;
      background: #e8f4fd; border: 1px solid #90caf9; border-radius: 10px;
      padding: 14px 16px; color: #1565c0;
    }
    .gip__notice mat-icon { flex-shrink: 0; }
    .gip__notice p { margin: 0; font-size: 14px; line-height: 1.45; }
    .gip__hint { color: #666; font-size: 14px; }
    .gip__actions { display: flex; gap: 10px; flex-wrap: wrap; margin: 16px 0; }
    .gip__errors { background: #fce4ec; padding: 12px; border-radius: 8px; font-size: 13px; color: #b71c1c; max-height: 120px; overflow: auto; }
    .gip__preview pre { font-size: 11px; max-height: 200px; overflow: auto; background: #f5f5f5; padding: 12px; border-radius: 8px; }
  `]
})
export class GameImportPanelComponent implements OnChanges {
  @Input() gameSetId!: string;
  @Input() gameType?: string;
  @Output() imported = new EventEmitter<void>();
  rows: Record<string, unknown>[] = [];
  previewRows: unknown[] = [];
  previewErrors: string[] = [];
  previewOk = false;
  importing = false;

  get hasGameSetId(): boolean {
    return !!String(this.gameSetId || '').trim();
  }

  constructor(private svc: InteractiveGameService, private notify: NotificationService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['gameSetId'] || changes['gameType']) {
      this.rows = [];
      this.previewRows = [];
      this.previewErrors = [];
      this.previewOk = false;
    }
  }

  downloadTemplate() {
    if (!this.hasGameSetId) {
      this.notify.error('Save Game Details first.');
      return;
    }
    this.svc.adminImportTemplate(this.gameSetId, this.gameType).subscribe({
      next: (r) => {
        const ws = XLSX.utils.json_to_sheet(r.template || []);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Import');
        XLSX.writeFile(wb, `glueck-arena-${r.gameType}-template.csv`);
      }
    });
  }

  onFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = new Uint8Array(reader.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      this.rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];
      this.preview();
    };
    reader.readAsArrayBuffer(file);
  }

  preview() {
    this.svc.adminImportPreview(this.gameSetId, this.rows, undefined, this.gameType).subscribe({
      next: (r) => {
        this.previewRows = r.preview || [];
        this.previewErrors = r.errors || [];
        this.previewOk = !!r.ok;
        if (!r.ok) this.notify.error('Validation errors — fix before import');
      }
    });
  }

  commit() {
    if (!this.previewOk) {
      this.notify.error('Please fix preview errors first');
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
        this.imported.emit();
      },
      error: () => { this.importing = false; this.notify.error('Import failed'); }
    });
  }
}
