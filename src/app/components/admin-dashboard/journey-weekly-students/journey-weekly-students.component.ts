import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { NotificationService } from '../../../services/notification.service';

interface WeeklyStudentRow {
  _id: string;
  name: string;
  regNo: string;
  email: string;
  level: string;
  currentDay: number;
  classesAttended: number;
  classesTotal: number;
  classTopics: string[];
  exercisesDone: number;
  exercisesTotal: number;
  exerciseAvgScore: number;
  attemptedExerciseTitles: string[];
  notAttemptedExerciseTitles: string[];
  dgBotCompleted: number;
  dgBotTotal: number;
  dgBotAvgScore: number;
  dgBotTitles: string[];
}

@Component({
  selector: 'app-journey-weekly-students',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
<div class="jws-root">
  <div class="jws-header">
    <a class="jws-back" [routerLink]="['/admin/journey']" [queryParams]="{ batch: batchName, tab: 'progress', progressOnly: 1 }">
      <i class="fas fa-arrow-left"></i> Back to Journey Progress
    </a>
    <h1 class="jws-title">Weekly student details</h1>
    <p class="jws-sub" *ngIf="batchName">
      Batch: <strong>{{ batchName }}</strong> · Week {{ week }} · Days {{ dayStart }}–{{ dayEnd }}
    </p>
  </div>

  <div class="jws-toolbar">
    <div class="jws-search">
      <i class="fas fa-search"></i>
      <input type="search" [(ngModel)]="search" placeholder="Search by name, email, ID…" autocomplete="off" />
    </div>
    <button type="button" class="jws-btn" (click)="load()" [disabled]="loading || !batchName || !week">
      <i class="fas fa-sync-alt" [class.fa-spin]="loading"></i> Refresh
    </button>
  </div>

  <div *ngIf="loading" class="jws-loading">
    <div class="spinner-border text-primary"></div>
    <p>Loading weekly student details…</p>
  </div>

  <div *ngIf="!loading && filteredRows.length === 0" class="jws-empty">
    <i class="fas fa-users"></i>
    <p *ngIf="rows.length === 0">No student details found for this week.</p>
    <p *ngIf="rows.length > 0">No rows match your search.</p>
  </div>

  <div class="jws-table-wrap" *ngIf="!loading && filteredRows.length > 0">
    <table class="jws-table">
      <thead>
        <tr>
          <th>Student</th>
          <th>Classes (attended/total)</th>
          <th>Exercises (completed/total)</th>
          <th>Exercise avg</th>
          <th>DG bot (completed/total)</th>
          <th>DG bot avg</th>
        </tr>
      </thead>
      <tbody>
        <tr *ngFor="let r of filteredRows">
          <td>
            <div class="jws-name">{{ r.name }}</div>
            <div class="jws-meta">{{ r.regNo }} · Day {{ r.currentDay }}</div>
            <div class="jws-meta">{{ r.email }}</div>
          </td>
          <td>
            <strong>{{ r.classesAttended }} / {{ r.classesTotal }}</strong>
            <button
              type="button"
              class="jws-link-btn"
              *ngIf="r.classTopics.length"
              (click)="toggleClassDetails(r._id)"
            >
              {{ isClassDetailsOpen(r._id) ? 'Show less' : 'Show more' }}
            </button>
            <div *ngIf="isClassDetailsOpen(r._id)">
              <div class="jws-tags" *ngIf="r.classTopics.length">
                <span class="jws-tag" *ngFor="let t of r.classTopics">{{ t }}</span>
              </div>
            </div>
          </td>
          <td>
            <strong>{{ r.exercisesDone }} / {{ r.exercisesTotal }}</strong>
            <button
              type="button"
              class="jws-link-btn"
              *ngIf="r.attemptedExerciseTitles.length || r.notAttemptedExerciseTitles.length"
              (click)="toggleExerciseDetails(r._id)"
            >
              {{ isExerciseDetailsOpen(r._id) ? 'Show less' : 'Show more' }}
            </button>
            <div *ngIf="isExerciseDetailsOpen(r._id)">
              <div class="jws-subhead" *ngIf="r.attemptedExerciseTitles.length">Attempted</div>
              <div class="jws-tags" *ngIf="r.attemptedExerciseTitles.length">
                <span class="jws-tag jws-tag-ex" *ngFor="let t of r.attemptedExerciseTitles">{{ t }}</span>
              </div>
              <div class="jws-subhead jws-subhead-miss" *ngIf="r.notAttemptedExerciseTitles.length">Not attempted</div>
              <div class="jws-tags" *ngIf="r.notAttemptedExerciseTitles.length">
                <span class="jws-tag jws-tag-miss" *ngFor="let t of r.notAttemptedExerciseTitles">{{ t }}</span>
              </div>
            </div>
          </td>
          <td>
            <span class="jws-pill">{{ r.exerciseAvgScore }}%</span>
          </td>
          <td>
            <strong>{{ r.dgBotCompleted }} / {{ r.dgBotTotal }}</strong>
            <button
              type="button"
              class="jws-link-btn"
              *ngIf="r.dgBotTitles.length"
              (click)="toggleDgBotDetails(r._id)"
            >
              {{ isDgBotDetailsOpen(r._id) ? 'Show less' : 'Show more' }}
            </button>
            <div *ngIf="isDgBotDetailsOpen(r._id)">
              <div class="jws-tags" *ngIf="r.dgBotTitles.length">
                <span class="jws-tag jws-tag-dg" *ngFor="let t of r.dgBotTitles">{{ t }}</span>
              </div>
            </div>
          </td>
          <td><span class="jws-pill jws-pill-dg">{{ r.dgBotAvgScore }}%</span></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
`,
  styles: [`
    .jws-root { max-width: 1280px; margin: 0 auto; padding: 20px 24px 40px; }
    .jws-header { margin-bottom: 14px; }
    .jws-back { color: #005b96; font-weight: 600; text-decoration: none; font-size: 13px; display: inline-flex; gap: 6px; align-items: center; }
    .jws-back:hover { text-decoration: underline; }
    .jws-title { margin: 8px 0 0; font-size: 1.5rem; font-weight: 800; color: #03396c; }
    .jws-sub { margin: 6px 0 0; color: #64748b; font-size: 13px; }
    .jws-toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
    .jws-search { position: relative; flex: 1; min-width: 260px; }
    .jws-search i { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: #94a3b8; font-size: 13px; }
    .jws-search input { width: 100%; border: 1px solid #dbe3ee; border-radius: 10px; padding: 9px 12px 9px 34px; font-size: 13px; }
    .jws-btn { border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 10px; padding: 9px 13px; font-size: 13px; font-weight: 600; }
    .jws-btn:disabled { opacity: .6; cursor: not-allowed; }
    .jws-loading, .jws-empty { border: 1px dashed #dbe3ee; background: #fff; border-radius: 12px; padding: 28px; text-align: center; color: #64748b; }
    .jws-empty i { font-size: 26px; margin-bottom: 8px; color: #94a3b8; }
    .jws-table-wrap { overflow-x: auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; }
    .jws-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 1050px; }
    .jws-table th { text-align: left; padding: 10px 12px; background: #f8fafc; color: #475569; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .jws-table td { padding: 12px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    .jws-name { font-weight: 700; color: #0f172a; }
    .jws-meta { color: #64748b; font-size: 11px; margin-top: 2px; }
    .jws-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .jws-link-btn {
      display: block;
      margin-top: 6px;
      border: none;
      background: transparent;
      color: #005b96;
      font-size: 11px;
      font-weight: 700;
      padding: 0;
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .jws-subhead { margin-top: 6px; font-size: 10px; font-weight: 700; color: #1d4ed8; text-transform: uppercase; letter-spacing: .04em; }
    .jws-subhead-miss { color: #b45309; }
    .jws-tag { padding: 2px 8px; border-radius: 999px; background: #eef2ff; color: #3730a3; font-size: 10px; font-weight: 700; }
    .jws-tag-ex { background: #dbeafe; color: #1d4ed8; }
    .jws-tag-miss { background: #fef3c7; color: #92400e; }
    .jws-tag-dg { background: #dcfce7; color: #166534; }
    .jws-pill { display: inline-flex; padding: 2px 8px; border-radius: 999px; background: #dbeafe; color: #1d4ed8; font-weight: 800; font-size: 11px; }
    .jws-pill-dg { background: #dcfce7; color: #166534; }
  `]
})
export class JourneyWeeklyStudentsComponent implements OnInit {
  batchName = '';
  week = 0;
  dayStart = 1;
  dayEnd = 7;
  loading = false;
  search = '';
  rows: WeeklyStudentRow[] = [];
  openClassDetailRows = new Set<string>();
  openExerciseDetailRows = new Set<string>();
  openDgBotDetailRows = new Set<string>();

  private readonly batchJourneyUrl = `${environment.apiUrl}/batch-journey`;

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      this.batchName = String(params.get('batch') || '').trim();
      this.week = parseInt(String(params.get('week') || ''), 10) || 0;
      this.dayStart = this.week > 0 ? (this.week - 1) * 7 + 1 : 1;
      this.dayEnd = this.week > 0 ? this.week * 7 : 7;
      if (this.batchName && this.week > 0) this.load();
    });
  }

  get filteredRows(): WeeklyStudentRow[] {
    const q = String(this.search || '').trim().toLowerCase();
    if (!q) return this.rows;
    return this.rows.filter((r) => {
      const blob = [
        r.name,
        r.email,
        r.regNo,
        r.level,
        ...r.classTopics,
        ...r.attemptedExerciseTitles,
        ...r.notAttemptedExerciseTitles,
        ...r.dgBotTitles
      ].map((x) => String(x || '').toLowerCase()).join(' ');
      return blob.includes(q);
    });
  }

  load(): void {
    if (!this.batchName || !this.week) return;
    this.loading = true;
    this.http.get<{ week: number; dayStart: number; dayEnd: number; rows: WeeklyStudentRow[] }>(
      `${this.batchJourneyUrl}/${encodeURIComponent(this.batchName)}/progress/week/${this.week}/students`,
      { withCredentials: true }
    ).subscribe({
      next: (res) => {
        this.rows = res?.rows || [];
        this.openClassDetailRows.clear();
        this.openExerciseDetailRows.clear();
        this.openDgBotDetailRows.clear();
        this.dayStart = res?.dayStart || this.dayStart;
        this.dayEnd = res?.dayEnd || this.dayEnd;
        this.loading = false;
      },
      error: (e) => {
        console.error(e);
        this.loading = false;
        this.rows = [];
        this.notify.error(e?.error?.message || 'Failed to load weekly student details.');
      }
    });
  }

  isExerciseDetailsOpen(studentId: string): boolean {
    return this.openExerciseDetailRows.has(String(studentId || ''));
  }

  toggleExerciseDetails(studentId: string): void {
    const key = String(studentId || '');
    if (!key) return;
    if (this.openExerciseDetailRows.has(key)) this.openExerciseDetailRows.delete(key);
    else this.openExerciseDetailRows.add(key);
  }

  isClassDetailsOpen(studentId: string): boolean {
    return this.openClassDetailRows.has(String(studentId || ''));
  }

  toggleClassDetails(studentId: string): void {
    const key = String(studentId || '');
    if (!key) return;
    if (this.openClassDetailRows.has(key)) this.openClassDetailRows.delete(key);
    else this.openClassDetailRows.add(key);
  }

  isDgBotDetailsOpen(studentId: string): boolean {
    return this.openDgBotDetailRows.has(String(studentId || ''));
  }

  toggleDgBotDetails(studentId: string): void {
    const key = String(studentId || '');
    if (!key) return;
    if (this.openDgBotDetailRows.has(key)) this.openDgBotDetailRows.delete(key);
    else this.openDgBotDetailRows.add(key);
  }
}
