// src/app/components/admin-dashboard/correct-details.component.ts
import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../../shared/material.module';
import { environment } from '../../../environments/environment';
import * as XLSX from 'xlsx';

type CdState = 'idle' | 'comparing' | 'review' | 'applying' | 'done';
type ViewFilter = 'diffs' | 'not_found' | 'all';

interface SheetRow {
  email: string;
  name: string;
  subscription: string;
  level: string;
  studentStatus: string;
  servicesOpted: string;
  batch: string;
  medium: string;
}

interface PortalSnap {
  _id: string;
  regNo: string;
  name: string;
  email: string;
  subscription: string;
  level: string;
  studentStatus: string;
  servicesOpted: string;
  batch: string;
  medium: string;
}

interface ComparisonRow {
  sheet: SheetRow;
  portal: PortalSnap | null;
  diffs: Set<string>;
  include: boolean;
}

interface CdField { key: string; label: string; icon: string; }

const CD_FIELDS: CdField[] = [
  { key: 'subscription', label: 'Package',       icon: 'fa-gem' },
  { key: 'level',        label: 'Level',          icon: 'fa-layer-group' },
  { key: 'studentStatus',label: 'Status',         icon: 'fa-toggle-on' },
  { key: 'servicesOpted',label: 'Services Opted', icon: 'fa-concierge-bell' },
  { key: 'batch',        label: 'Batch',          icon: 'fa-users' },
  { key: 'medium',       label: 'Medium',         icon: 'fa-laptop' },
];

@Component({
  selector: 'app-correct-details',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  styles: [`
    /* ─── Panel shell ─────────────────────────────────────────── */
    .cd-panel {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,.08);
      margin-bottom: 20px;
    }

    /* ─── Header ─────────────────────────────────────────────── */
    .cd-header {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 18px 24px;
      background: linear-gradient(135deg, #0f4c81 0%, #1565c0 100%);
      color: #fff;
    }
    .cd-header__icon {
      width: 44px; height: 44px;
      background: rgba(255,255,255,.18);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; flex-shrink: 0;
    }
    .cd-header__text { flex: 1; }
    .cd-header__text h2 { margin: 0; font-size: 18px; font-weight: 700; }
    .cd-header__text p  { margin: 2px 0 0; font-size: 13px; opacity: .82; }
    .cd-close-btn {
      background: rgba(255,255,255,.15);
      border: none; border-radius: 8px;
      width: 34px; height: 34px;
      color: #fff; cursor: pointer; font-size: 16px;
      display: flex; align-items: center; justify-content: center;
      transition: background .15s;
    }
    .cd-close-btn:hover { background: rgba(255,255,255,.28); }

    /* ─── Step indicator ─────────────────────────────────────── */
    .cd-steps {
      display: flex; align-items: center; gap: 0;
      padding: 12px 24px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
    }
    .cd-step {
      display: flex; align-items: center; gap: 8px;
      font-size: 13px; color: #94a3b8; font-weight: 500;
      padding: 4px 10px; border-radius: 20px;
      transition: all .2s;
    }
    .cd-step--active { color: #1565c0; background: #e3f2fd; font-weight: 700; }
    .cd-step--done   { color: #16a34a; }
    .cd-step__num {
      width: 22px; height: 22px;
      border-radius: 50%;
      background: currentColor;
      color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700; flex-shrink: 0;
      background: #cbd5e1;
    }
    .cd-step--active .cd-step__num { background: #1565c0; }
    .cd-step--done   .cd-step__num { background: #16a34a; }
    .cd-step__arrow { color: #cbd5e1; padding: 0 4px; font-size: 14px; }

    /* ─── Body padding ───────────────────────────────────────── */
    .cd-body { padding: 24px; }

    /* ─── Upload area ────────────────────────────────────────── */
    .cd-upload-zone {
      border: 2px dashed #cbd5e1;
      border-radius: 12px;
      padding: 36px 24px;
      text-align: center;
      background: #f8fafc;
      transition: all .2s;
      cursor: pointer;
      position: relative;
    }
    .cd-upload-zone--drag {
      border-color: #1565c0;
      background: #e3f2fd;
    }
    .cd-upload-zone__icon { font-size: 48px; color: #64748b; margin-bottom: 12px; }
    .cd-upload-zone--drag .cd-upload-zone__icon { color: #1565c0; }
    .cd-upload-zone__title {
      font-size: 16px; font-weight: 600; color: #1e293b; margin: 0 0 6px;
    }
    .cd-upload-zone__sub {
      font-size: 13px; color: #64748b; margin: 0 0 16px;
    }
    .cd-upload-btn {
      display: inline-flex; align-items: center; gap: 8px;
      background: #1565c0; color: #fff;
      border: none; border-radius: 8px;
      padding: 10px 20px; font-size: 14px; font-weight: 600;
      cursor: pointer; transition: background .15s;
    }
    .cd-upload-btn:hover { background: #0d47a1; }

    /* Column guide */
    .cd-col-guide {
      margin-top: 24px;
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 16px 20px;
      text-align: left;
    }
    .cd-col-guide h4 {
      font-size: 13px; font-weight: 700; color: #374151; margin: 0 0 10px;
      text-transform: uppercase; letter-spacing: .5px;
    }
    .cd-col-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .cd-col-tag {
      display: inline-flex; align-items: center;
      padding: 3px 10px;
      background: #f1f5f9; border: 1px solid #e2e8f0;
      border-radius: 12px; font-size: 12px; color: #475569; font-family: monospace;
    }
    .cd-col-tag--req {
      background: #fef3c7; border-color: #f59e0b; color: #92400e; font-weight: 700;
    }
    .cd-col-note { font-size: 12px; color: #94a3b8; margin: 0; }

    .cd-parse-error {
      display: flex; align-items: center; gap: 8px;
      background: #fef2f2; border: 1px solid #fecaca;
      border-radius: 8px; padding: 10px 14px;
      color: #dc2626; font-size: 13px; margin-top: 14px;
    }

    /* ─── Comparing spinner ──────────────────────────────────── */
    .cd-comparing {
      padding: 48px 24px;
      text-align: center;
      color: #64748b;
    }
    .cd-comparing__icon { font-size: 36px; color: #1565c0; margin-bottom: 12px; }
    .cd-comparing p { font-size: 15px; margin: 0; }

    /* ─── Review ─────────────────────────────────────────────── */
    .cd-summary {
      display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
      margin-bottom: 16px;
    }
    .cd-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px; font-weight: 500;
      border: 2px solid transparent;
      cursor: pointer; transition: all .15s;
    }
    .cd-chip--all    { background: #f1f5f9; color: #475569; }
    .cd-chip--diff   { background: #fff7ed; color: #c2410c; border-color: #fed7aa; }
    .cd-chip--clean  { background: #f0fdf4; color: #166534; }
    .cd-chip--miss   { background: #fef2f2; color: #b91c1c; }
    .cd-chip--active, .cd-chip:hover { border-color: currentColor !important; }
    .cd-chip strong  { font-weight: 700; font-size: 15px; }
    .cd-chip-spacer  { flex: 1; }
    .cd-reupload {
      display: inline-flex; align-items: center; gap: 6px;
      background: none; border: 1px solid #cbd5e1;
      border-radius: 8px; padding: 5px 12px;
      font-size: 12px; color: #64748b; cursor: pointer;
      transition: all .15s;
    }
    .cd-reupload:hover { border-color: #94a3b8; color: #374151; }

    /* Field toggles */
    .cd-field-toggles {
      display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
      padding: 14px 16px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      margin-bottom: 16px;
    }
    .cd-ft-label {
      font-size: 12px; font-weight: 700; color: #64748b;
      text-transform: uppercase; letter-spacing: .5px;
      margin-right: 4px;
    }
    .cd-ft-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 12px; border-radius: 20px;
      font-size: 12px; font-weight: 600;
      border: 2px solid #e2e8f0;
      background: #fff; color: #64748b;
      cursor: pointer; transition: all .15s;
    }
    .cd-ft-chip--on {
      background: #e3f2fd; border-color: #1565c0; color: #1565c0;
    }
    .cd-ft-chip:hover { border-color: #94a3b8; }
    .cd-ft-chip--on:hover { border-color: #0d47a1; }
    .cd-ft-chip i { font-size: 13px; }

    /* Empty state */
    .cd-empty {
      text-align: center; padding: 36px 24px;
      color: #64748b;
    }
    .cd-empty i { font-size: 36px; color: #16a34a; margin-bottom: 10px; }
    .cd-empty p { margin: 6px 0 14px; font-size: 15px; }

    /* ─── Table ──────────────────────────────────────────────── */
    .cd-table-wrap {
      overflow-x: auto;
      max-height: 520px;
      overflow-y: auto;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
    }
    .cd-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .cd-table thead { position: sticky; top: 0; z-index: 10; }
    .cd-th {
      background: #1e293b;
      color: #e2e8f0;
      padding: 10px 12px;
      text-align: left;
      white-space: nowrap;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: .3px;
    }
    .cd-th--check  { width: 36px; text-align: center; }
    .cd-th--student { min-width: 180px; }
    .cd-th--match  { width: 90px; }
    .cd-th--field  { min-width: 160px; }
    .cd-th--disabled { opacity: .45; text-decoration: line-through; }

    .cd-tr { transition: background .1s; }
    .cd-tr:hover { background: #f8fafc; }
    .cd-tr--notfound { background: #fef9f9; }
    .cd-tr--included { }
    .cd-tr:not(:last-child) td { border-bottom: 1px solid #f1f5f9; }

    .cd-td { padding: 10px 12px; vertical-align: top; }
    .cd-td--check { text-align: center; vertical-align: middle; }
    .cd-td--student { vertical-align: middle; }

    .cd-student-name  { font-weight: 600; color: #1e293b; font-size: 13px; }
    .cd-student-email { font-size: 11px; color: #64748b; margin-top: 2px; }
    .cd-student-reg   { font-size: 11px; color: #94a3b8; margin-top: 1px; }

    .cd-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 8px; border-radius: 20px;
      font-size: 11px; font-weight: 600;
    }
    .cd-badge--found   { background: #f0fdf4; color: #16a34a; }
    .cd-badge--missing { background: #fef2f2; color: #dc2626; }

    /* Diff cell states */
    .cd-td--diff         { background: #fff8f0; }
    .cd-td--diff-inactive{ background: #f8f8f8; }
    .cd-td--same         { background: #f0fdf4; }
    .cd-td--na           { background: #f8f8f8; }

    .cd-val--na   { color: #94a3b8; }
    .cd-val--same { color: #4ade80; font-weight: 500; font-size: 12px; }
    .cd-check-icon { font-size: 11px; margin-right: 4px; }

    /* Diff cell */
    .cd-diff-cell {
      display: flex; flex-direction: column; gap: 5px;
    }
    .cd-diff-row {
      display: flex; align-items: center; gap: 6px;
    }
    .cd-diff-lbl {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .5px; min-width: 36px;
    }
    .cd-diff-lbl--portal { color: #94a3b8; }
    .cd-diff-lbl--sheet  { color: #1565c0; }
    .cd-diff-lbl--skip   { color: #94a3b8; }

    .cd-diff-val {
      font-size: 12px; font-weight: 600;
      padding: 2px 7px; border-radius: 4px;
    }
    .cd-diff-val--old  {
      background: #fef3c7; color: #92400e;
      text-decoration: line-through; opacity: .8;
    }
    .cd-diff-val--new  { background: #dbeafe; color: #1e40af; }
    .cd-diff-val--skip { background: #f1f5f9; color: #94a3b8; font-weight: 400; }
    .cd-diff-arrow { color: #94a3b8; font-size: 11px; padding: 1px 2px; }

    /* ─── Action bar ─────────────────────────────────────────── */
    .cd-action-bar {
      display: flex; flex-wrap: wrap; align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 0 4px;
    }
    .cd-action-left, .cd-action-right {
      display: flex; align-items: center; gap: 8px;
    }
    .cd-update-summary {
      display: flex; align-items: center; gap: 6px;
      font-size: 13px; color: #64748b;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 6px 12px;
    }
    .cd-update-summary strong { color: #1565c0; font-weight: 700; }
    .cd-apply-btn {
      display: inline-flex; align-items: center; gap: 8px;
      background: #16a34a; color: #fff;
      border: none; border-radius: 8px;
      padding: 10px 20px; font-size: 14px; font-weight: 700;
      cursor: pointer; transition: background .15s;
    }
    .cd-apply-btn:hover:not(:disabled) { background: #15803d; }
    .cd-apply-btn:disabled { background: #86efac; cursor: not-allowed; }

    .btn-sm {
      padding: 5px 12px !important;
      font-size: 12px !important;
    }

    /* ─── Done ───────────────────────────────────────────────── */
    .cd-done {
      text-align: center;
      padding: 40px 24px;
    }
    .cd-done__icon { font-size: 52px; color: #16a34a; margin-bottom: 12px; }
    .cd-done h3 { margin: 0 0 20px; font-size: 22px; color: #1e293b; }
    .cd-done-stats {
      display: flex; justify-content: center; flex-wrap: wrap; gap: 16px;
      margin-bottom: 20px;
    }
    .cd-done-stat {
      padding: 16px 28px; border-radius: 12px;
      display: flex; flex-direction: column; align-items: center; gap: 4px;
    }
    .cd-done-stat strong { font-size: 32px; font-weight: 800; line-height: 1; }
    .cd-done-stat span { font-size: 13px; }
    .cd-done-stat--success { background: #f0fdf4; color: #16a34a; }
    .cd-done-stat--warn    { background: #fffbeb; color: #d97706; }
    .cd-done-stat--error   { background: #fef2f2; color: #dc2626; }

    .cd-done-failed {
      text-align: left;
      background: #fef2f2;
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 20px;
    }
    .cd-done-failed h4 { font-size: 13px; color: #dc2626; margin: 0 0 8px; }
    .cd-fail-row {
      display: flex; gap: 12px; font-size: 12px;
      padding: 4px 0; border-bottom: 1px solid #fecaca;
    }
    .cd-fail-row:last-child { border-bottom: none; }
    .cd-fail-id     { color: #64748b; font-family: monospace; }
    .cd-fail-reason { color: #dc2626; }

    .cd-done-actions {
      display: flex; justify-content: center; gap: 12px; flex-wrap: wrap;
    }
  `],
  template: `
<div class="cd-panel">

  <!-- ══ Header ══════════════════════════════════════════════ -->
  <div class="cd-header">
    <div class="cd-header__icon"><i class="fas fa-file-alt"></i></div>
    <div class="cd-header__text">
      <h2>Correct Student Details</h2>
      <p>Upload an Excel sheet, compare against portal data, and selectively apply corrections</p>
    </div>
    <button class="cd-close-btn" type="button" (click)="closed.emit()" title="Close">
      <i class="fas fa-times"></i>
    </button>
  </div>

  <!-- ══ Step indicator ═══════════════════════════════════════ -->
  <div class="cd-steps">
    <div class="cd-step"
         [class.cd-step--active]="state==='idle'"
         [class.cd-step--done]="state!=='idle'">
      <span class="cd-step__num">
        <ng-container *ngIf="state==='idle'">1</ng-container>
        <ng-container *ngIf="state!=='idle'"><i class="fas fa-check"></i></ng-container>
      </span>
      Upload Sheet
    </div>
    <span class="cd-step__arrow">›</span>

    <div class="cd-step"
         [class.cd-step--active]="state==='comparing'||state==='review'"
         [class.cd-step--done]="state==='applying'||state==='done'">
      <span class="cd-step__num">
        <ng-container *ngIf="state==='applying'||state==='done'"><i class="fas fa-check"></i></ng-container>
        <ng-container *ngIf="state!=='applying'&&state!=='done'">2</ng-container>
      </span>
      Review Differences
    </div>
    <span class="cd-step__arrow">›</span>

    <div class="cd-step"
         [class.cd-step--active]="state==='applying'||state==='done'">
      <span class="cd-step__num">3</span>
      Apply Updates
    </div>
  </div>

  <!-- ══ Body ════════════════════════════════════════════════ -->
  <div class="cd-body">

    <!-- ── IDLE: upload zone ─────────────────────────────── -->
    <ng-container *ngIf="state==='idle'">
      <div class="cd-upload-zone"
           [class.cd-upload-zone--drag]="dragOver"
           (dragover)="onDragOver($event)"
           (dragleave)="onDragLeave()"
           (drop)="onDrop($event)">

        <div class="cd-upload-zone__icon">
          <i class="fas fa-file-excel"></i>
        </div>
        <p class="cd-upload-zone__title">
          {{ dragOver ? 'Release to upload' : 'Drop your Excel / CSV here' }}
        </p>
        <p class="cd-upload-zone__sub">
          Supports&nbsp;<strong>.xlsx</strong>, <strong>.xls</strong>, <strong>.csv</strong>
        </p>

        <label class="cd-upload-btn" role="button" tabindex="0">
          <i class="fas fa-upload"></i> Choose File
          <input type="file" accept=".xlsx,.xls,.csv" style="display:none"
                 (change)="onFileSelect($event)">
        </label>

        <!-- Column guide -->
        <div class="cd-col-guide">
          <h4>Expected columns in your sheet (flexible naming)</h4>
          <div class="cd-col-tags">
            <span class="cd-col-tag cd-col-tag--req">email&nbsp;*</span>
            <span class="cd-col-tag">name</span>
            <span class="cd-col-tag">subscription&nbsp;/&nbsp;package</span>
            <span class="cd-col-tag">level</span>
            <span class="cd-col-tag">studentStatus&nbsp;/&nbsp;status</span>
            <span class="cd-col-tag">servicesOpted&nbsp;/&nbsp;services</span>
            <span class="cd-col-tag">batch</span>
            <span class="cd-col-tag">medium</span>
          </div>
          <p class="cd-col-note">
            <i class="fas fa-info-circle"></i>&nbsp;
            Column names are case-insensitive and underscores/spaces are stripped automatically.
            Students are matched by <strong>email address</strong>.
          </p>
        </div>
      </div>

      <p class="cd-parse-error" *ngIf="parseError">
        <i class="fas fa-exclamation-circle"></i> {{ parseError }}
      </p>
    </ng-container>

    <!-- ── COMPARING ─────────────────────────────────────── -->
    <div class="cd-comparing" *ngIf="state==='comparing'">
      <div class="cd-comparing__icon"><i class="fas fa-spinner fa-spin"></i></div>
      <p>{{ comparingMsg }}</p>
    </div>

    <!-- ── REVIEW ────────────────────────────────────────── -->
    <ng-container *ngIf="state==='review'">

      <!-- Summary chips -->
      <div class="cd-summary">
        <span class="cd-chip cd-chip--all"
              [class.cd-chip--active]="viewFilter==='all'"
              (click)="viewFilter='all'">
          <i class="fas fa-list"></i>
          <strong>{{ rows.length }}</strong>&nbsp;total from sheet
        </span>
        <span class="cd-chip cd-chip--diff"
              [class.cd-chip--active]="viewFilter==='diffs'"
              (click)="viewFilter='diffs'">
          <i class="fas fa-exclamation-circle"></i>
          <strong>{{ diffRows.length }}</strong>&nbsp;with differences
        </span>
        <span class="cd-chip cd-chip--clean">
          <i class="fas fa-check-circle"></i>
          <strong>{{ cleanRows.length }}</strong>&nbsp;already match
        </span>
        <span class="cd-chip cd-chip--miss"
              [class.cd-chip--active]="viewFilter==='not_found'"
              (click)="viewFilter='not_found'"
              *ngIf="notFoundRows.length > 0">
          <i class="fas fa-question-circle"></i>
          <strong>{{ notFoundRows.length }}</strong>&nbsp;not in portal
        </span>
        <span class="cd-chip-spacer"></span>
        <button class="cd-reupload" type="button" (click)="reset()">
          <i class="fas fa-redo"></i> Re-upload
        </button>
      </div>

      <!-- Field toggles -->
      <div class="cd-field-toggles">
        <span class="cd-ft-label">Fields to update:</span>
        <button *ngFor="let f of fields"
                type="button"
                class="cd-ft-chip"
                [class.cd-ft-chip--on]="fieldToggles[f.key]"
                (click)="fieldToggles[f.key]=!fieldToggles[f.key]"
                [title]="fieldToggles[f.key] ? 'Click to skip ' + f.label : 'Click to include ' + f.label">
          <i class="fas" [class.fa-check-square]="fieldToggles[f.key]"
                         [class.fa-square]="!fieldToggles[f.key]"></i>
          <i class="fas" [ngClass]="f.icon"></i>
          {{ f.label }}
        </button>
      </div>

      <!-- Empty diff state -->
      <div class="cd-empty" *ngIf="filteredRows.length===0 && viewFilter==='diffs'">
        <i class="fas fa-check-circle"></i>
        <p>No differences found for the enabled fields — all matched students already have the same values.</p>
        <button class="cd-reupload" type="button" (click)="viewFilter='all'">View all students</button>
      </div>

      <!-- Diff table -->
      <div class="cd-table-wrap" *ngIf="filteredRows.length > 0">
        <table class="cd-table">
          <thead>
            <tr>
              <th class="cd-th cd-th--check">
                <input type="checkbox"
                       [checked]="selectedStudentCount===matchedRows.length && matchedRows.length>0"
                       [indeterminate]="selectedStudentCount>0 && selectedStudentCount<matchedRows.length"
                       (change)="toggleAllInclude($any($event.target).checked)"
                       title="Select / deselect all">
              </th>
              <th class="cd-th cd-th--student">Student</th>
              <th class="cd-th cd-th--match">Portal Match</th>
              <th *ngFor="let f of fields"
                  class="cd-th cd-th--field"
                  [class.cd-th--disabled]="!fieldToggles[f.key]">
                <i class="fas" [ngClass]="f.icon"></i>&nbsp;{{ f.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let row of filteredRows; trackBy: trackByEmail"
                class="cd-tr"
                [class.cd-tr--notfound]="!row.portal">

              <!-- Checkbox -->
              <td class="cd-td cd-td--check">
                <input type="checkbox" [disabled]="!row.portal" [(ngModel)]="row.include">
              </td>

              <!-- Student info -->
              <td class="cd-td cd-td--student">
                <div class="cd-student-name">{{ row.portal?.name || row.sheet.name || '—' }}</div>
                <div class="cd-student-email">{{ row.sheet.email }}</div>
                <div class="cd-student-reg" *ngIf="row.portal?.regNo">{{ row.portal!.regNo }}</div>
              </td>

              <!-- Match badge -->
              <td class="cd-td">
                <span *ngIf="row.portal" class="cd-badge cd-badge--found">
                  <i class="fas fa-check-circle"></i> Found
                </span>
                <span *ngIf="!row.portal" class="cd-badge cd-badge--missing">
                  <i class="fas fa-times-circle"></i> Not found
                </span>
              </td>

              <!-- Field cells -->
              <td *ngFor="let f of fields"
                  class="cd-td cd-td--field"
                  [class.cd-td--diff]="row.portal && row.diffs.has(f.key) && fieldToggles[f.key]"
                  [class.cd-td--diff-inactive]="row.portal && row.diffs.has(f.key) && !fieldToggles[f.key]"
                  [class.cd-td--same]="row.portal && !row.diffs.has(f.key)"
                  [class.cd-td--na]="!row.portal">

                <!-- No portal match -->
                <span *ngIf="!row.portal" class="cd-val--na">—</span>

                <!-- No diff -->
                <span *ngIf="row.portal && !row.diffs.has(f.key)" class="cd-val--same">
                  <i class="fas fa-check cd-check-icon"></i>
                  {{ getVal(row.portal, f.key) }}
                </span>

                <!-- Diff — field is ON (will update) -->
                <div *ngIf="row.portal && row.diffs.has(f.key) && fieldToggles[f.key]"
                     class="cd-diff-cell">
                  <div class="cd-diff-row">
                    <span class="cd-diff-lbl cd-diff-lbl--portal">Portal</span>
                    <span class="cd-diff-val cd-diff-val--old">{{ getVal(row.portal, f.key) }}</span>
                  </div>
                  <div class="cd-diff-row">
                    <span class="cd-diff-arrow"><i class="fas fa-arrow-right"></i></span>
                    <span class="cd-diff-lbl cd-diff-lbl--sheet">Sheet</span>
                    <span class="cd-diff-val cd-diff-val--new">{{ getVal(row.sheet, f.key) }}</span>
                  </div>
                </div>

                <!-- Diff — field is OFF (will skip) -->
                <div *ngIf="row.portal && row.diffs.has(f.key) && !fieldToggles[f.key]"
                     class="cd-diff-cell">
                  <div class="cd-diff-row">
                    <span class="cd-diff-lbl cd-diff-lbl--portal">Portal</span>
                    <span class="cd-diff-val cd-diff-val--old">{{ getVal(row.portal, f.key) }}</span>
                  </div>
                  <div class="cd-diff-row">
                    <span class="cd-diff-lbl cd-diff-lbl--skip">Skipped</span>
                    <span class="cd-diff-val cd-diff-val--skip">{{ getVal(row.sheet, f.key) }}</span>
                  </div>
                </div>

              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Action bar -->
      <div class="cd-action-bar" *ngIf="diffRows.length > 0">
        <div class="cd-action-left">
          <button type="button" class="cd-reupload btn-sm" (click)="toggleAllDiffsInclude()">
            <i class="fas fa-check-double"></i> Select all with differences
          </button>
          <button type="button" class="cd-reupload btn-sm" (click)="toggleAllInclude(false)">
            <i class="fas fa-times"></i> Deselect all
          </button>
        </div>
        <div class="cd-action-right">
          <div class="cd-update-summary" *ngIf="pendingUpdates > 0">
            <i class="fas fa-info-circle"></i>
            <strong>{{ selectedStudentCount }}</strong>&nbsp;students
            &nbsp;·&nbsp;
            <strong>{{ pendingUpdates }}</strong>&nbsp;field updates pending
          </div>
          <button type="button"
                  class="cd-apply-btn"
                  (click)="applyChanges()"
                  [disabled]="pendingUpdates === 0">
            <i class="fas fa-check-double"></i>
            Apply {{ pendingUpdates > 0 ? pendingUpdates + ' Updates' : 'Changes' }}
          </button>
        </div>
      </div>

    </ng-container>

    <!-- ── APPLYING ───────────────────────────────────────── -->
    <div class="cd-comparing" *ngIf="state==='applying'">
      <div class="cd-comparing__icon"><i class="fas fa-spinner fa-spin"></i></div>
      <p>Applying {{ pendingUpdates }} field updates to {{ selectedStudentCount }} students…</p>
    </div>

    <!-- ── DONE ──────────────────────────────────────────── -->
    <div class="cd-done" *ngIf="state==='done'">
      <div class="cd-done__icon"><i class="fas fa-check-circle"></i></div>
      <h3>Update Complete</h3>

      <div class="cd-done-stats">
        <div class="cd-done-stat cd-done-stat--success">
          <strong>{{ applyResult?.updated ?? 0 }}</strong>
          <span>Students updated</span>
        </div>
        <div class="cd-done-stat cd-done-stat--warn"
             *ngIf="(applyResult?.skipped ?? 0) > 0">
          <strong>{{ applyResult!.skipped }}</strong>
          <span>Skipped (no changes)</span>
        </div>
        <div class="cd-done-stat cd-done-stat--error"
             *ngIf="(applyResult?.failed?.length ?? 0) > 0">
          <strong>{{ applyResult!.failed.length }}</strong>
          <span>Failed</span>
        </div>
      </div>

      <div class="cd-done-failed" *ngIf="(applyResult?.failed?.length ?? 0) > 0">
        <h4><i class="fas fa-exclamation-triangle"></i> Failed updates:</h4>
        <div class="cd-fail-row" *ngFor="let f of applyResult!.failed">
          <span class="cd-fail-id">{{ f.studentId }}</span>
          <span class="cd-fail-reason">{{ f.reason }}</span>
        </div>
      </div>

      <div class="cd-done-actions">
        <button type="button" class="cd-reupload" (click)="reset()">
          <i class="fas fa-redo"></i> Upload another sheet
        </button>
        <button type="button" class="cd-apply-btn" (click)="closed.emit()">
          <i class="fas fa-check"></i> Done
        </button>
      </div>
    </div>

  </div><!-- /cd-body -->
</div><!-- /cd-panel -->
  `
})
export class CorrectDetailsComponent {
  @Output() closed = new EventEmitter<void>();

  state: CdState = 'idle';
  viewFilter: ViewFilter = 'diffs';
  dragOver = false;
  fileName = '';
  parseError = '';
  comparingMsg = '';

  rows: ComparisonRow[] = [];
  fieldToggles: Record<string, boolean> = {
    subscription:  true,
    level:         true,
    studentStatus: true,
    servicesOpted: true,
    batch:         false,
    medium:        false,
  };

  applyResult: { updated: number; failed: { studentId: string; reason: string }[]; skipped: number } | null = null;

  readonly fields = CD_FIELDS;

  constructor(private http: HttpClient, private snackBar: MatSnackBar) {}

  // ── Computed helpers ────────────────────────────────────────

  get matchedRows()  { return this.rows.filter(r => r.portal); }
  get notFoundRows() { return this.rows.filter(r => !r.portal); }
  get diffRows()     { return this.matchedRows.filter(r => [...r.diffs].some(f => this.fieldToggles[f])); }
  get cleanRows()    { return this.matchedRows.filter(r => ![...r.diffs].some(f => this.fieldToggles[f])); }

  get filteredRows(): ComparisonRow[] {
    switch (this.viewFilter) {
      case 'not_found': return this.notFoundRows;
      case 'all':       return this.rows;
      default:          return this.diffRows;
    }
  }

  get pendingUpdates(): number {
    let count = 0;
    for (const row of this.rows) {
      if (!row.include || !row.portal) continue;
      for (const f of CD_FIELDS) {
        if (this.fieldToggles[f.key] && row.diffs.has(f.key)) count++;
      }
    }
    return count;
  }

  get selectedStudentCount(): number {
    return this.rows.filter(r => r.include && r.portal).length;
  }

  // ── File handling ────────────────────────────────────────────

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    this.processFile(input.files[0]);
    input.value = '';
  }

  onDragOver(event: DragEvent): void { event.preventDefault(); this.dragOver = true; }
  onDragLeave(): void { this.dragOver = false; }
  onDrop(event: DragEvent): void {
    event.preventDefault(); this.dragOver = false;
    const file = event.dataTransfer?.files[0];
    if (file) this.processFile(file);
  }

  private processFile(file: File): void {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      this.parseError = 'Only .xlsx, .xls, or .csv files are supported.';
      return;
    }
    this.parseError = '';
    this.fileName = file.name;

    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      try {
        const wb = XLSX.read(e.target!.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (!json.length) { this.parseError = 'The sheet appears to be empty.'; return; }
        const sheetRows = this.normalizeRows(json);
        if (!sheetRows.length) {
          this.parseError = 'No rows with a valid email found. Make sure the sheet has an "email" column.';
          return;
        }
        this.fetchAndCompare(sheetRows);
      } catch (err: any) {
        this.parseError = `Parse error: ${err.message ?? err}`;
      }
    };
    reader.readAsBinaryString(file);
  }

  private normalizeRows(json: Record<string, any>[]): SheetRow[] {
    return json.map(raw => {
      const norm: Record<string, string> = {};
      for (const k of Object.keys(raw)) {
        norm[k.toLowerCase().replace(/[\s_\-]/g, '')] = String(raw[k] ?? '').trim();
      }

      const get = (...aliases: string[]) => {
        for (const a of aliases) {
          const v = norm[a.toLowerCase().replace(/[\s_\-]/g, '')];
          if (v !== undefined && v !== '') return v;
        }
        return '';
      };

      return {
        email:         get('email').toLowerCase(),
        name:          get('name', 'studentname', 'fullname', 'studentfullname'),
        subscription:  get('subscription', 'package', 'plan', 'packageopted', 'subscriptionplan').toUpperCase(),
        level:         get('level', 'languagelevel', 'currentlevel').toUpperCase(),
        studentStatus: get('studentstatus', 'status', 'studentstatus2').toUpperCase(),
        servicesOpted: get('servicesopted', 'service', 'services', 'serviceopted'),
        batch:         get('batch', 'batchno', 'batchname', 'batchnumber'),
        medium:        get('medium', 'learningmedium'),
      } as SheetRow;
    }).filter(r => r.email && r.email.includes('@'));
  }

  private fetchAndCompare(sheetRows: SheetRow[]): void {
    this.state = 'comparing';
    this.comparingMsg = `Comparing ${sheetRows.length} rows with portal data…`;

    this.http.post<{ success: boolean; students: PortalSnap[] }>(
      `${environment.apiUrl}/admin/students/lookup-by-emails`,
      { emails: sheetRows.map(r => r.email) },
      { withCredentials: true }
    ).subscribe({
      next: (res) => {
        const map = new Map<string, PortalSnap>(
          (res.students ?? []).map(s => [s.email.toLowerCase(), s])
        );

        this.rows = sheetRows.map(sheet => {
          const portal = map.get(sheet.email) ?? null;
          const diffs = new Set<string>();

          if (portal) {
            for (const f of CD_FIELDS) {
              const sv = String((sheet as any)[f.key] ?? '').trim().toUpperCase();
              const pv = String((portal as any)[f.key] ?? '').trim().toUpperCase();
              if (sv && sv !== pv) diffs.add(f.key);
            }
          }
          return { sheet, portal, diffs, include: !!portal && diffs.size > 0 };
        });

        this.viewFilter = this.diffRows.length > 0 ? 'diffs' : 'all';
        this.state = 'review';
      },
      error: (err) => {
        this.parseError = `Portal lookup failed: ${err.error?.message ?? err.statusText}`;
        this.state = 'idle';
      }
    });
  }

  // ── Selection helpers ────────────────────────────────────────

  toggleAllInclude(val: boolean): void {
    for (const r of this.rows) if (r.portal) r.include = val;
  }

  toggleAllDiffsInclude(): void {
    for (const r of this.diffRows)  r.include = true;
    for (const r of this.cleanRows) r.include = false;
  }

  // ── Apply ────────────────────────────────────────────────────

  applyChanges(): void {
    const corrections: { studentId: string; updates: Record<string, string> }[] = [];

    for (const row of this.rows) {
      if (!row.include || !row.portal) continue;
      const updates: Record<string, string> = {};
      for (const f of CD_FIELDS) {
        if (this.fieldToggles[f.key] && row.diffs.has(f.key)) {
          updates[f.key] = (row.sheet as any)[f.key];
        }
      }
      if (Object.keys(updates).length) {
        corrections.push({ studentId: row.portal._id, updates });
      }
    }

    if (!corrections.length) {
      this.snackBar.open('No changes selected.', 'OK', { duration: 3000 });
      return;
    }

    this.state = 'applying';
    this.http.post<{ success: boolean; updated: number; failed: any[]; skipped: number }>(
      `${environment.apiUrl}/admin/batch-correct-details`,
      { corrections },
      { withCredentials: true }
    ).subscribe({
      next: (res) => {
        this.applyResult = {
          updated: res.updated ?? 0,
          failed: res.failed ?? [],
          skipped: res.skipped ?? 0
        };
        this.state = 'done';
      },
      error: (err) => {
        this.snackBar.open(`Error: ${err.error?.message ?? 'Server error'}`, 'Close', { duration: 5000 });
        this.state = 'review';
      }
    });
  }

  // ── Misc ─────────────────────────────────────────────────────

  reset(): void {
    this.state      = 'idle';
    this.fileName   = '';
    this.parseError = '';
    this.rows       = [];
    this.applyResult = null;
    this.dragOver   = false;
    this.viewFilter = 'diffs';
  }

  getVal(obj: any, field: string): string {
    const v = String(obj?.[field] ?? '').trim();
    return v || '—';
  }

  trackByEmail(_: number, row: ComparisonRow): string {
    return row.sheet.email;
  }
}
