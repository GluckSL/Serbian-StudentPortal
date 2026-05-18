import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { NotificationService } from '../../../../../services/notification.service';
import { GameSet, GameType } from '../../../glueck-arena.types';

@Component({
  selector: 'app-game-set-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, MaterialModule],
  template: `
    <div class="ga-page">
      <header class="ga-hero">
        <div class="ga-hero__copy">
          <div class="ga-hero__badge"><mat-icon>sports_esports</mat-icon> GlückArena</div>
          <h1>Game modules</h1>
          <p>Create games, assign them to batches, and publish when ready. Students only see GlückArena if their batch has at least one published game.</p>
        </div>
        <div class="ga-hero__actions">
          <button mat-stroked-button class="ga-btn-ghost" routerLink="/admin/glueck-arena/command-center">
            <mat-icon>dashboard</mat-icon> Command Center
          </button>
          <button mat-stroked-button class="ga-btn-ghost" routerLink="/admin/glueck-arena/analytics">
            <mat-icon>insights</mat-icon> Analytics
          </button>
          <button mat-raised-button color="primary" routerLink="/admin/glueck-arena/create">
            <mat-icon>add</mat-icon> New game set
          </button>
        </div>
      </header>

      <div class="ga-stats" *ngIf="!loadError && !loading">
        <div class="ga-stat">
          <span class="ga-stat__value">{{ pagination.total }}</span>
          <span class="ga-stat__label">Total sets</span>
        </div>
        <div class="ga-stat">
          <span class="ga-stat__value">{{ publishedCount }}</span>
          <span class="ga-stat__label">Published</span>
        </div>
        <div class="ga-stat">
          <span class="ga-stat__value">{{ draftCount }}</span>
          <span class="ga-stat__label">Drafts</span>
        </div>
      </div>

      <div class="ga-toolbar">
        <div class="ga-toolbar__search">
          <mat-icon>search</mat-icon>
          <input type="search" [(ngModel)]="searchTerm" (ngModelChange)="onSearch()"
            placeholder="Search game sets…" aria-label="Search game sets">
        </div>
        <div class="ga-toolbar__dropdown-wrap">
          <div class="ga-toolbar__dropdown" (click)="typeOpen = !typeOpen">
            <span>{{ getTypeLabel(filterGameType) }}</span>
            <mat-icon>expand_more</mat-icon>
          </div>
          <div class="ga-toolbar__dropdown-menu" *ngIf="typeOpen">
            <div class="ga-toolbar__dropdown-item" (click)="setType('')">All types</div>
            <div class="ga-toolbar__dropdown-item" (click)="setType('scramble_rush')">Scramble Rush</div>
            <div class="ga-toolbar__dropdown-item" (click)="setType('sentence_builder')">Sentence Builder</div>
            <div class="ga-toolbar__dropdown-item" (click)="setType('matching')">Matching</div>
            <div class="ga-toolbar__dropdown-item" (click)="setType('flashcards')">Flashcards</div>
          </div>
        </div>
        <div class="ga-toolbar__dropdown-wrap">
          <div class="ga-toolbar__dropdown" (click)="statusOpen = !statusOpen">
            <span>{{ getStatusLabel(filterPublished) }}</span>
            <mat-icon>expand_more</mat-icon>
          </div>
          <div class="ga-toolbar__dropdown-menu" *ngIf="statusOpen">
            <div class="ga-toolbar__dropdown-item" (click)="setStatus('')">All</div>
            <div class="ga-toolbar__dropdown-item" (click)="setStatus(true)">Published</div>
            <div class="ga-toolbar__dropdown-item" (click)="setStatus(false)">Draft</div>
          </div>
        </div>
      </div>

      <div *ngIf="loading" class="ga-loading">
        <mat-spinner diameter="44"></mat-spinner>
        <span>Loading game sets…</span>
      </div>

      <div *ngIf="loadError && !loading" class="ga-error">
        <mat-icon>cloud_off</mat-icon>
        <h3>Could not load game sets</h3>
        <p>{{ loadError }}</p>
        <button mat-raised-button color="primary" (click)="load()">
          <mat-icon>refresh</mat-icon> Try again
        </button>
      </div>

      <div *ngIf="!loading && !loadError" class="ga-table-card">
        <table mat-table [dataSource]="sets" class="ga-table">
          <ng-container matColumnDef="title">
            <th mat-header-cell *matHeaderCellDef>Game</th>
            <td mat-cell *matCellDef="let s">
              <div class="ga-row-title">
                <div class="ga-row-title__icon"><mat-icon>{{ s.icon || 'sports_esports' }}</mat-icon></div>
                <div>
                  <strong>{{ s.title }}</strong>
                  <span class="ga-row-title__meta">{{ s.questionCount || 0 }} questions · {{ s.estimatedDurationMinutes || '—' }} min</span>
                </div>
              </div>
            </td>
          </ng-container>

          <ng-container matColumnDef="batches">
            <th mat-header-cell *matHeaderCellDef>Batches</th>
            <td mat-cell *matCellDef="let s">
              <span *ngIf="!(s.targetBatches?.length)" class="ga-batch-pill ga-batch-pill--all">All batches</span>
              <div *ngIf="s.targetBatches?.length" class="ga-batch-chips">
                <span *ngFor="let b of s.targetBatches | slice:0:2" class="ga-batch-pill">{{ b }}</span>
                <span *ngIf="s.targetBatches.length > 2" class="ga-batch-pill ga-batch-pill--more">+{{ s.targetBatches.length - 2 }}</span>
              </div>
            </td>
          </ng-container>

          <ng-container matColumnDef="gameType">
            <th mat-header-cell *matHeaderCellDef>Type</th>
            <td mat-cell *matCellDef="let s">
              <span class="ga-pill ga-pill--blue">{{ formatType(s.gameType) }}</span>
            </td>
          </ng-container>

          <ng-container matColumnDef="difficulty">
            <th mat-header-cell *matHeaderCellDef>Difficulty</th>
            <td mat-cell *matCellDef="let s">
              <span class="ga-pill" [class]="'ga-pill--' + (s.difficulty | lowercase)">{{ s.difficulty }}</span>
            </td>
          </ng-container>

          <ng-container matColumnDef="level">
            <th mat-header-cell *matHeaderCellDef>CEFR</th>
            <td mat-cell *matCellDef="let s">{{ s.level || '—' }}</td>
          </ng-container>

          <ng-container matColumnDef="xp">
            <th mat-header-cell *matHeaderCellDef>XP</th>
            <td mat-cell *matCellDef="let s"><span class="ga-xp">⚡ {{ s.xpReward }}</span></td>
          </ng-container>

          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef>Status</th>
            <td mat-cell *matCellDef="let s">
              <span class="ga-status" [class.ga-status--live]="s.isPublished && s.visibleToStudents">
                {{ s.isPublished ? (s.visibleToStudents ? 'Live' : 'Published') : 'Draft' }}
              </span>
            </td>
          </ng-container>

          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let s">
              <button mat-icon-button matTooltip="Edit" [routerLink]="['/admin/glueck-arena', s._id, 'edit']">
                <mat-icon>edit</mat-icon>
              </button>
              <button mat-icon-button [matTooltip]="s.isPublished ? 'Unpublish' : 'Publish'" (click)="togglePublish(s)">
                <mat-icon>{{ s.isPublished ? 'visibility_off' : 'publish' }}</mat-icon>
              </button>
              <button mat-icon-button matTooltip="Delete" color="warn" (click)="deleteSet(s)">
                <mat-icon>delete</mat-icon>
              </button>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="columns"></tr>
          <tr mat-row *matRowDef="let row; columns: columns;" class="ga-table__row"></tr>
        </table>

        <div *ngIf="sets.length === 0" class="ga-empty">
          <mat-icon>sports_esports</mat-icon>
          <h3>No game sets yet</h3>
          <p>Create your first module and assign it to a batch so students can see GlückArena.</p>
          <button mat-raised-button color="primary" routerLink="/admin/glueck-arena/create">
            <mat-icon>add</mat-icon> Create game set
          </button>
        </div>

        <mat-paginator
          *ngIf="pagination.total > pagination.limit"
          [length]="pagination.total"
          [pageSize]="pagination.limit"
          [pageIndex]="pagination.page - 1"
          (page)="onPage($event)"
        ></mat-paginator>
      </div>
    </div>
  `,
  styles: [`
    .ga-page { padding: 28px 32px 48px; max-width: 1280px; margin: 0 auto; }
    .ga-hero {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; flex-wrap: wrap;
      padding: 28px 32px; border-radius: 20px; margin-bottom: 24px;
      background: linear-gradient(135deg, #1e3a5f 0%, #405980 55%, #5b7fb8 100%);
      color: #fff; box-shadow: 0 12px 40px rgba(30, 58, 95, 0.25);
    }
    .ga-hero h1 { margin: 8px 0 6px; font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
    .ga-hero p { margin: 0; opacity: 0.9; max-width: 520px; line-height: 1.5; font-size: 14px; }
    .ga-hero__badge {
      display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.85;
    }
    .ga-hero__actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .ga-btn-ghost { color: #fff !important; border-color: rgba(255,255,255,0.45) !important; }
    .ga-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; margin-bottom: 20px; }
    .ga-stat {
      background: #fff; border-radius: 14px; padding: 18px 20px; border: 1px solid #e8ecf4;
      box-shadow: 0 2px 8px rgba(64, 89, 128, 0.06);
    }
    .ga-stat__value { display: block; font-size: 26px; font-weight: 700; color: #1e3a5f; }
    .ga-stat__label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
    .ga-toolbar {
      display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 16px;
      background: #fff; padding: 14px 16px; border-radius: 14px; border: 1px solid #e8ecf4;
    }
    .ga-toolbar__search {
      flex: 1; min-width: 200px; display: flex; align-items: center; gap: 10px;
      padding: 0 14px; height: 48px; border-radius: 12px;
      background: #f8fafc; border: 1px solid #e8ecf4;
    }
    .ga-toolbar__search mat-icon { color: #94a3b8; }
    .ga-toolbar__search input {
      flex: 1; border: none; background: transparent; outline: none;
      font-size: 14px; color: #334155;
    }
    .ga-toolbar__dropdown-wrap { position: relative; }
    .ga-toolbar__dropdown {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 0 14px; height: 48px; min-width: 130px; border-radius: 12px;
      background: #f8fafc; border: 1px solid #e8ecf4; cursor: pointer;
      font-size: 14px; color: #334155;
    }
    .ga-toolbar__dropdown mat-icon { color: #94a3b8; transition: transform 0.2s; }
    .ga-toolbar__dropdown:hover { border-color: #94a3b8; }
    .ga-toolbar__dropdown-menu {
      position: absolute; top: 100%; left: 0; z-index: 100; margin-top: 6px; min-width: 100%;
      background: #fff; border: 1px solid #e8ecf4;
      border-radius: 12px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.15);
      overflow: hidden;
    }
    .ga-toolbar__dropdown-item {
      padding: 12px 16px; font-size: 14px; color: #334155; cursor: pointer;
      transition: background 0.15s;
    }
    .ga-toolbar__dropdown-item:hover { background: #f1f5f9; }
    .ga-loading, .ga-error, .ga-empty { text-align: center; padding: 56px 24px; }
    .ga-loading { display: flex; flex-direction: column; align-items: center; gap: 16px; color: #64748b; }
    .ga-error mat-icon, .ga-empty mat-icon { font-size: 56px; width: 56px; height: 56px; color: #94a3b8; }
    .ga-error h3, .ga-empty h3 { margin: 12px 0 8px; color: #334155; }
    .ga-error p, .ga-empty p { color: #64748b; margin-bottom: 20px; }
    .ga-table-card {
      background: #fff; border-radius: 16px; border: 1px solid #e8ecf4;
      overflow: hidden; box-shadow: 0 4px 20px rgba(64, 89, 128, 0.08);
    }
    .ga-table { width: 100%; table-layout: auto; }
    .ga-table th, .ga-table td { white-space: normal; word-wrap: break-word; }
    .ga-table .ga-pill { white-space: nowrap; }
    .ga-table__row:hover { background: #f8fafc; }
    .ga-row-title { display: flex; align-items: flex-start; gap: 12px; min-width: 280px; }
    .ga-row-title__icon {
      width: 40px; height: 40px; border-radius: 10px; background: #eef2ff;
      display: flex; align-items: center; justify-content: center; color: #405980;
    }
    .ga-row-title__meta { display: block; font-size: 12px; color: #94a3b8; font-weight: 400; margin-top: 2px; }
    .ga-pill { padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .ga-pill--blue { background: #dbeafe; color: #1d4ed8; }
    .ga-pill--beginner { background: #dcfce7; color: #166534; }
    .ga-pill--intermediate { background: #ffedd5; color: #c2410c; }
    .ga-pill--advanced { background: #fce7f3; color: #9d174d; }
    .ga-batch-chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .ga-batch-pill {
      font-size: 11px; padding: 3px 8px; border-radius: 6px; background: #f1f5f9; color: #475569;
      max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .ga-batch-pill--all { background: #e0e7ff; color: #3730a3; }
    .ga-batch-pill--more { background: #e2e8f0; }
    .ga-xp { color: #d97706; font-weight: 600; font-size: 13px; }
    .ga-status { font-size: 12px; padding: 4px 10px; border-radius: 999px; background: #f1f5f9; color: #64748b; }
    .ga-status--live { background: #dcfce7; color: #166534; }
    @media (max-width: 900px) {
      .ga-page { padding: 16px; }
      .ga-hero { padding: 20px; }
    }
  `]
})
export class GameSetListComponent implements OnInit {
  columns = ['title', 'batches', 'gameType', 'difficulty', 'level', 'xp', 'status', 'actions'];
  sets: GameSet[] = [];
  loading = false;
  loadError = '';
  searchTerm = '';
  filterGameType = '';
  filterPublished: boolean | '' = '';
  searchTimeout: ReturnType<typeof setTimeout> | undefined;
  pagination = { page: 1, limit: 15, total: 0 };
  typeOpen = false;
  statusOpen = false;

  getTypeLabel(v: string): string { return v ? this.formatType(v as GameType) : 'Game type'; }
  getStatusLabel(v: boolean | ''): string {
    if (v === true) return 'Published';
    if (v === false) return 'Draft';
    return 'Status';
  }
  setType(v: string) { this.filterGameType = v; this.typeOpen = false; this.load(); }
  setStatus(v: boolean | '') { this.filterPublished = v; this.statusOpen = false; this.load(); }

  get publishedCount(): number { return this.sets.filter(s => s.isPublished).length; }
  get draftCount(): number { return this.sets.filter(s => !s.isPublished).length; }

  constructor(
    private svc: InteractiveGameService,
    private notify: NotificationService,
    private router: Router
  ) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.loadError = '';
    const params: Record<string, unknown> = { page: this.pagination.page, limit: this.pagination.limit };
    if (this.filterGameType) params['gameType'] = this.filterGameType;
    if (this.filterPublished !== '') params['isPublished'] = this.filterPublished;
    if (this.searchTerm.trim()) params['search'] = this.searchTerm.trim();

    this.svc.adminListSets(params as Parameters<InteractiveGameService['adminListSets']>[0]).subscribe({
      next: (r) => {
        this.sets = r.sets || [];
        this.pagination = { ...this.pagination, ...r.pagination };
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.loadError = err?.error?.message || 'Check that the API server is running and you are signed in as admin.';
        this.notify.error('Failed to load game sets');
      }
    });
  }

  onSearch() {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => { this.pagination.page = 1; this.load(); }, 400);
  }

  onPage(e: { pageIndex: number }) { this.pagination.page = e.pageIndex + 1; this.load(); }

  formatType(t: GameType): string {
    const map: Record<string, string> = {
      scramble_rush: 'Scramble Rush', sentence_builder: 'Sentence Builder',
      matching: 'Matching', flashcards: 'Flashcards'
    };
    return map[t] ?? t;
  }

  togglePublish(set: GameSet) {
    this.svc.adminUpdateSet(set._id, { isPublished: !set.isPublished }).subscribe({
      next: (r) => {
        set.isPublished = r.set.isPublished;
        this.notify.success(set.isPublished ? 'Published' : 'Unpublished');
      },
      error: () => this.notify.error('Update failed')
    });
  }

  deleteSet(set: GameSet) {
    if (!confirm(`Delete "${set.title}"? This cannot be undone.`)) return;
    this.svc.adminDeleteSet(set._id).subscribe({
      next: () => {
        this.sets = this.sets.filter(s => s._id !== set._id);
        this.pagination.total = Math.max(0, this.pagination.total - 1);
        this.notify.success('Deleted');
      },
      error: () => this.notify.error('Delete failed')
    });
  }
}
