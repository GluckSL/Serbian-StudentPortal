// Journey directory: Platinum (active journey batches) + Silver (GO students).

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { NotificationService } from '../../../services/notification.service';

interface PlatinumStudentRow {
  _id: string;
  name: string;
  regNo: string;
  email: string;
  level: string;
  studentStatus: string;
  currentCourseDay: number;
  batch: string;
  enrollmentDate: string | null;
}

interface GoStudentRow {
  _id: string;
  name: string;
  regNo: string;
  email: string;
  subscription: string;
  goStatus: string;
  goJoiningDate: string;
  currentCourseDay?: number;
  storedCourseDay?: number;
  needsJourneySync?: boolean;
  batch?: string;
  level?: string;
  studentStatus?: string;
  displayPassword?: string | null;
  lastLogin?: string | null;
}

@Component({
  selector: 'app-journey-all-students',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
<div class="jas-root">
  <div class="jas-header">
    <a routerLink="/admin/journey" class="jas-back"><i class="fas fa-arrow-left"></i> Journey Management</a>
    <h1 class="jas-title"><span class="jas-icon">👥</span> All students</h1>
    <p class="jas-sub">Platinum: learners in <strong>active</strong> journey batches. Silver tabs: Tamil GO (<strong>GO-SILVER</strong>) and Sinhala GO (<strong>GO-SINHALA</strong>).</p>
  </div>

  <div class="jas-plan-tabs">
    <button type="button" class="jas-tab" [class.jas-tab--active]="tab === 'platinum'" (click)="tab = 'platinum'">
      <span class="jas-tab-icon">💎</span> Platinum
    </button>
    <button type="button" class="jas-tab" [class.jas-tab--active]="tab === 'silver'" (click)="onSilverTab('tamil')">
      <span class="jas-tab-icon">🥈</span> Silver GO (Tamil)
    </button>
    <button type="button" class="jas-tab" [class.jas-tab--active]="tab === 'silver-sinhala'" (click)="onSilverTab('sinhala')">
      <span class="jas-tab-icon">🥈</span> Silver Sinhala
    </button>
  </div>

  <div class="jas-panel" *ngIf="tab === 'platinum'">
    <div class="jas-toolbar">
      <div class="jas-search">
        <i class="fas fa-search"></i>
        <input type="search" [(ngModel)]="platinumSearch" placeholder="Search name, email, batch, ID…" autocomplete="off" />
      </div>
      <button type="button" class="jas-btn jas-btn-outline" (click)="loadPlatinum()" [disabled]="loadingPlatinum">
        <i class="fas fa-sync-alt" [class.fa-spin]="loadingPlatinum"></i> Refresh
      </button>
    </div>

    <div *ngIf="loadingPlatinum" class="jas-skeleton-wrap" aria-busy="true" aria-label="Loading students">
      <div class="jas-skeleton-table">
        <div class="jas-skeleton-table-head">
          <span class="jas-skeleton-line" *ngFor="let _ of [1,2,3,4,5,6]"></span>
        </div>
        <div class="jas-skeleton-table-row" *ngFor="let _ of [1,2,3,4,5,6,7,8]">
          <span class="jas-skeleton-line jas-skeleton-cell--name"></span>
          <span class="jas-skeleton-line jas-skeleton-cell--id"></span>
          <span class="jas-skeleton-line jas-skeleton-cell--chip"></span>
          <span class="jas-skeleton-line jas-skeleton-cell--chip"></span>
          <span class="jas-skeleton-line jas-skeleton-cell--chip"></span>
          <span class="jas-skeleton-line jas-skeleton-cell--day"></span>
        </div>
      </div>
    </div>

    <div *ngIf="!loadingPlatinum && filteredPlatinum.length === 0" class="jas-empty">
      <i class="fas fa-users fa-3x"></i>
      <p *ngIf="platinumStudents.length === 0">No students in active journey batches, or no batches are active yet.</p>
      <p *ngIf="platinumStudents.length > 0">No rows match your search.</p>
    </div>

    <div class="jas-table-wrap" *ngIf="!loadingPlatinum && filteredPlatinum.length > 0">
      <table class="jas-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Student ID</th>
            <th>Batch</th>
            <th>Level</th>
            <th>Status</th>
            <th>Journey day</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let s of filteredPlatinum">
            <td>
              <div class="jas-name">{{ s.name }}</div>
              <div class="jas-email">{{ s.email }}</div>
            </td>
            <td class="jas-mono">{{ s.regNo }}</td>
            <td><span class="jas-pill">{{ s.batch }}</span></td>
            <td>{{ s.level || '—' }}</td>
            <td>{{ s.studentStatus || '—' }}</td>
            <td><span class="jas-day-pill">Day {{ s.currentCourseDay }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="jas-panel" *ngIf="tab === 'silver' || tab === 'silver-sinhala'">
    <div class="jas-toolbar">
      <div class="jas-search">
        <i class="fas fa-search"></i>
        <input type="search" [(ngModel)]="silverSearch" placeholder="Search name, email, batch, ID…" autocomplete="off" />
      </div>
      <button type="button" class="jas-btn jas-btn-outline" (click)="loadGoStudents()" [disabled]="loadingGo">
        <i class="fas fa-sync-alt" [class.fa-spin]="loadingGo"></i> Refresh
      </button>
    </div>

    <div *ngIf="loadingGo" class="jas-skeleton-wrap" aria-busy="true" aria-label="Loading GO students">
      <div class="jas-skeleton-table">
        <div class="jas-skeleton-table-head jas-skeleton-table-head--go">
          <span class="jas-skeleton-line" *ngFor="let _ of [1,2,3,4,5,6,7,8]"></span>
        </div>
        <div class="jas-skeleton-table-row jas-skeleton-table-row--go" *ngFor="let _ of [1,2,3,4,5,6,7,8]">
          <span class="jas-skeleton-line jas-skeleton-cell--name"></span>
          <span class="jas-skeleton-line jas-skeleton-cell--id"></span>
          <span class="jas-skeleton-line jas-skeleton-cell--chip"></span>
          <span class="jas-skeleton-line jas-skeleton-cell--chip"></span>
          <span class="jas-skeleton-line jas-skeleton-cell--chip"></span>
          <span class="jas-skeleton-line jas-skeleton-cell--date"></span>
          <span class="jas-skeleton-line jas-skeleton-cell--day"></span>
          <span class="jas-skeleton-line jas-skeleton-cell--actions"></span>
        </div>
      </div>
    </div>

    <div *ngIf="!loadingGo && filteredGo.length === 0" class="jas-empty">
      <i class="fas fa-users fa-3x"></i>
      <p *ngIf="goStudents.length === 0">No GO students yet.</p>
      <p *ngIf="goStudents.length > 0">No rows match your search.</p>
    </div>

    <div class="jas-table-wrap" *ngIf="!loadingGo && filteredGo.length > 0">
      <table class="jas-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Student ID</th>
            <th>Batch</th>
            <th>Status</th>
            <th>Plan</th>
            <th>Joining date</th>
            <th>Journey day</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let s of filteredGo">
            <td>
              <div class="jas-name">{{ s.name }}</div>
              <div class="jas-email">{{ s.email }}</div>
            </td>
            <td>
              <div class="jas-mono">{{ s.regNo }}</div>
              <div class="jas-sub" *ngIf="s.displayPassword">{{ s.displayPassword }}</div>
              <div class="jas-muted jas-sub" *ngIf="!s.displayPassword">—</div>
            </td>
            <td>{{ s.batch || '—' }}</td>
            <td><span class="jas-badge-go">{{ s.goStatus }}</span></td>
            <td><span class="jas-badge-plan">{{ s.subscription }}</span></td>
            <td>
              <div>
                <span *ngIf="s.goJoiningDate">{{ s.goJoiningDate | date:'dd MMM yyyy' }}</span>
                <span *ngIf="!s.goJoiningDate" class="jas-muted">—</span>
              </div>
              <div class="jas-sub">
                <span *ngIf="s.lastLogin">{{ s.lastLogin | date:'dd MMM yyyy, HH:mm' }}</span>
                <span *ngIf="!s.lastLogin" class="jas-muted">Never logged in</span>
              </div>
            </td>
            <td>
              <span class="jas-day-pill">Day {{ s.currentCourseDay || 1 }}</span>
              <span *ngIf="s.needsJourneySync" class="jas-sync-hint" title="Stored day was higher; effective day shown until you open their detail">*</span>
            </td>
            <td>
              <button type="button" class="jas-btn jas-btn-outline jas-btn-sm" (click)="openGoStudentDetail(s)">
                <i class="fas fa-external-link-alt"></i> Open
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</div>
  `,
  styles: [`
    .jas-root { max-width: 1200px; margin: 0 auto; padding: 20px 24px 48px; }
    .jas-header { margin-bottom: 20px; }
    .jas-back {
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 13px; font-weight: 600; color: #005b96; text-decoration: none; margin-bottom: 10px;
    }
    .jas-back:hover { text-decoration: underline; }
    .jas-title { margin: 0; font-size: 1.5rem; font-weight: 800; color: #03396c; display: flex; align-items: center; gap: 10px; }
    .jas-icon { font-size: 1.35rem; }
    .jas-sub { margin: 8px 0 0; font-size: 13px; color: #64748b; line-height: 1.45; }
    .jas-plan-tabs {
      display: flex; gap: 6px; margin-bottom: 18px;
    }
    .jas-tab {
      padding: 8px 20px; border: 2px solid #e2e8f0; border-radius: 10px 10px 0 0;
      background: #f8fafc; color: #64748b; font-size: 13px; font-weight: 600;
      cursor: pointer; font-family: inherit; display: inline-flex; align-items: center; gap: 6px;
    }
    .jas-tab:hover { background: #e8f4fc; color: #005b96; border-color: #93c5fd; }
    .jas-tab--active {
      background: #fff; border-color: #005b96; border-bottom-color: #fff; color: #005b96;
      position: relative; z-index: 1;
    }
    .jas-panel {
      background: #fff; border: 1px solid #e2e8f0; border-radius: 0 14px 14px 14px;
      padding: 18px; box-shadow: 0 2px 12px rgba(15, 23, 42, 0.06);
    }
    .jas-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 16px; }
    .jas-search {
      flex: 1; min-width: 220px; position: relative;
    }
    .jas-search i {
      position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #94a3b8; font-size: 13px;
    }
    .jas-search input {
      width: 100%; padding: 10px 12px 10px 36px; border: 1px solid #e2e8f0; border-radius: 10px;
      font-size: 13px;
    }
    .jas-btn {
      padding: 9px 16px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer;
      font-family: inherit; border: none; display: inline-flex; align-items: center; gap: 8px;
    }
    .jas-btn-outline { background: #fff; border: 1px solid #cbd5e1; color: #334155; }
    .jas-btn-outline:hover:not(:disabled) { background: #f8fafc; border-color: #005b96; color: #005b96; }
    .jas-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .jas-btn-sm { padding: 6px 12px; font-size: 12px; }
    .jas-skeleton-wrap {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
    }
    .jas-skeleton-table-head,
    .jas-skeleton-table-row {
      display: grid;
      gap: 12px;
      padding: 12px 14px;
      align-items: center;
    }
    .jas-skeleton-table-head {
      grid-template-columns: 2fr 1fr 0.9fr 0.8fr 0.8fr 0.75fr;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
    }
    .jas-skeleton-table-head--go,
    .jas-skeleton-table-row--go {
      grid-template-columns: 2fr 1fr 0.85fr 0.75fr 0.75fr 1fr 0.75fr 0.9fr;
    }
    .jas-skeleton-table-row {
      grid-template-columns: 2fr 1fr 0.9fr 0.8fr 0.8fr 0.75fr;
      border-bottom: 1px solid #f1f5f9;
    }
    .jas-skeleton-table-row--go { border-bottom: 1px solid #f1f5f9; }
    .jas-skeleton-table-row:last-child { border-bottom: none; }
    .jas-skeleton-line {
      display: block;
      height: 10px;
      width: 100%;
      border-radius: 999px;
      background: linear-gradient(90deg, #edf2f7 20%, #e2e8f0 50%, #edf2f7 80%);
      background-size: 200% 100%;
      animation: jas-shimmer 1.25s ease-in-out infinite;
    }
    .jas-skeleton-cell--name { width: 88%; height: 28px; border-radius: 8px; }
    .jas-skeleton-cell--id { width: 70%; }
    .jas-skeleton-cell--chip { width: 58%; }
    .jas-skeleton-cell--date { width: 72%; }
    .jas-skeleton-cell--day { width: 50%; }
    .jas-skeleton-cell--actions { width: 65%; justify-self: end; }
    @keyframes jas-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    .jas-empty { text-align: center; padding: 48px 20px; color: #94a3b8; }
    .jas-empty p { margin-top: 12px; font-size: 14px; }
    .jas-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .jas-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .jas-table th {
      text-align: left; padding: 10px 12px; background: #f8fafc; color: #475569;
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
      border-bottom: 1px solid #e2e8f0;
    }
    .jas-table td { padding: 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
    .jas-name { font-weight: 600; color: #0f172a; }
    .jas-email { font-size: 11px; color: #64748b; margin-top: 2px; }
    .jas-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
    .jas-mono { font-family: ui-monospace, monospace; font-size: 12px; }
    .jas-pill {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      background: #e0f2fe; color: #0369a1; font-weight: 600; font-size: 12px;
    }
    .jas-day-pill {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      background: #eef2ff; color: #3730a3; font-weight: 700; font-size: 12px;
    }
    .jas-sync-hint { margin-left: 4px; color: #ca8a04; font-weight: 700; cursor: help; }
    .jas-badge-go { background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 8px; font-weight: 700; font-size: 11px; }
    .jas-badge-plan { background: #e0e7ff; color: #3730a3; padding: 2px 8px; border-radius: 8px; font-weight: 700; font-size: 11px; }
    .jas-muted { color: #94a3b8; }
  `]
})
export class JourneyAllStudentsComponent implements OnInit {
  tab: 'platinum' | 'silver' | 'silver-sinhala' = 'platinum';
  private goApiPath = 'go-students';

  platinumStudents: PlatinumStudentRow[] = [];
  loadingPlatinum = false;
  platinumSearch = '';

  goStudents: GoStudentRow[] = [];
  loadingGo = false;
  silverSearch = '';

  private readonly batchJourneyUrl = `${environment.apiUrl}/batch-journey`;

  constructor(
    private http: HttpClient,
    private router: Router,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadPlatinum();
  }

  get filteredPlatinum(): PlatinumStudentRow[] {
    return this.filterPlatinumRows(this.platinumStudents, this.platinumSearch);
  }

  get filteredGo(): GoStudentRow[] {
    return this.filterGoRows(this.goStudents, this.silverSearch);
  }

  private filterPlatinumRows(rows: PlatinumStudentRow[], q: string): PlatinumStudentRow[] {
    const s = String(q || '').trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      const blob = [r.name, r.email, r.regNo, r.batch, r.level, r.studentStatus]
        .map((x) => String(x ?? '').toLowerCase())
        .join(' ');
      return blob.includes(s);
    });
  }

  private filterGoRows(rows: GoStudentRow[], q: string): GoStudentRow[] {
    const s = String(q || '').trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      const blob = [r.name, r.email, r.regNo, r.batch, r.level, r.studentStatus, r.subscription, r.goStatus]
        .map((x) => String(x ?? '').toLowerCase())
        .join(' ');
      return blob.includes(s);
    });
  }

  loadPlatinum(): void {
    this.loadingPlatinum = true;
    this.http
      .get<{ students: PlatinumStudentRow[] }>(`${this.batchJourneyUrl}/active-platinum-students`, {
        withCredentials: true
      })
      .subscribe({
        next: (r) => {
          this.platinumStudents = r.students || [];
          this.loadingPlatinum = false;
        },
        error: (e) => {
          console.error(e);
          this.loadingPlatinum = false;
          this.notify.error(e?.error?.message || 'Failed to load Platinum students.');
        }
      });
  }

  onSilverTab(track: 'tamil' | 'sinhala'): void {
    const nextTab = track === 'sinhala' ? 'silver-sinhala' : 'silver';
    if (this.tab === nextTab) return;
    this.tab = nextTab;
    this.goApiPath = track === 'sinhala' ? 'go-students-sinhala' : 'go-students';
    this.goStudents = [];
    this.loadGoStudents();
  }

  loadGoStudents(): void {
    this.loadingGo = true;
    this.http
      .get<{ students: GoStudentRow[] }>(`${environment.apiUrl}/${this.goApiPath}`, {
        params: { enrich: '1' },
        withCredentials: true
      })
      .subscribe({
      next: (r) => {
        this.goStudents = r.students || [];
        this.loadingGo = false;
      },
      error: (e) => {
        console.error(e);
        this.loadingGo = false;
        this.notify.error(e?.error?.message || 'Failed to load GO students.');
      }
    });
  }

  openGoStudentDetail(student: GoStudentRow): void {
    const queryParams = this.tab === 'silver-sinhala' ? { track: 'sinhala' } : {};
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/admin/journey/go', student._id], { queryParams })
    );
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
