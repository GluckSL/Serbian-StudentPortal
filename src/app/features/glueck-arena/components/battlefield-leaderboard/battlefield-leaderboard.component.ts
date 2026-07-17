import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { BattlefieldLeaderboardEntry, BattlefieldStatsDto } from '../../glueck-arena.types';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-battlefield-leaderboard',
  standalone: true,
  imports: [CommonModule, RouterModule, MaterialModule],
  template: `
    <div class="bf-lb">
      <div class="bf-lb__top">
        <button mat-icon-button routerLink="/glueck-arena/battlefield" aria-label="Back">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <div class="bf-lb__brand">
          <mat-icon>military_tech</mat-icon>
          <h1>Rang-lista bojnog polja</h1>
        </div>
      </div>

      <!-- My Stats Card -->
      <div class="bf-lb__my-stats" *ngIf="myStats">
        <div class="bf-lb__my-tier">
          <span class="bf-lb__tier-badge" [class]="'bf-lb__tier-badge--' + myStats.tier">{{ myStats.tier | titlecase }}</span>
        </div>
        <div class="bf-lb__my-details">
          <div class="bf-lb__my-stat">
            <span class="bf-lb__my-val">{{ myStats.elo }}</span>
            <span class="bf-lb__my-lbl">ELO</span>
          </div>
          <div class="bf-lb__my-stat">
            <span class="bf-lb__my-val">{{ myStats.wins }}</span>
            <span class="bf-lb__my-lbl">Wins</span>
          </div>
          <div class="bf-lb__my-stat">
            <span class="bf-lb__my-val">{{ myStats.losses }}</span>
            <span class="bf-lb__my-lbl">Losses</span>
          </div>
          <div class="bf-lb__my-stat">
            <span class="bf-lb__my-val">{{ myStats.gamesPlayed }}</span>
            <span class="bf-lb__my-lbl">Total</span>
          </div>
        </div>
      </div>

      <!-- Leaderboard Table -->
      <div class="bf-lb__table-wrap" *ngIf="!loading">
        <table class="bf-lb__table" *ngIf="entries.length > 0">
          <thead>
            <tr>
              <th>#</th>
              <th>Igrač</th>
              <th>Tier</th>
              <th>ELO</th>
              <th>W</th>
              <th>L</th>
              <th>Win %</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let e of entries" [class.bf-lb__row--me]="e.isMe">
              <td class="bf-lb__rank">{{ e.rank }}</td>
              <td class="bf-lb__name">{{ e.name }}</td>
              <td>
                <span class="bf-lb__tier-badge" [class]="'bf-lb__tier-badge--' + e.tier">{{ e.tier | titlecase }}</span>
              </td>
              <td class="bf-lb__elo">{{ e.elo }}</td>
              <td class="bf-lb__wins">{{ e.wins }}</td>
              <td class="bf-lb__losses">{{ e.losses }}</td>
              <td class="bf-lb__winrate">{{ e.winRate }}%</td>
            </tr>
          </tbody>
        </table>

        <div class="bf-lb__empty" *ngIf="entries.length === 0">
          <mat-icon>leaderboard</mat-icon>
          <h3>Još nema rangiranih igrača</h3>
          <p>Igrajte igre na bojnom polju da osvojite ELO</p>
          <button mat-raised-button color="primary" routerLink="/glueck-arena/battlefield">
            <mat-icon>sports_kabaddi</mat-icon> Go to Battlefield
          </button>
        </div>
      </div>

      <div class="bf-lb__pagination" *ngIf="total > limit">
        <button mat-stroked-button [disabled]="page <= 1" (click)="goPage(page - 1)">
          Previous
        </button>
        <span class="bf-lb__page-info">Page {{ page }} of {{ totalPages }}</span>
        <button mat-stroked-button [disabled]="page >= totalPages" (click)="goPage(page + 1)">
          Next
        </button>
      </div>

      <div class="bf-lb__loading" *ngIf="loading">
        <mat-spinner diameter="40"></mat-spinner>
      </div>
    </div>
  `,
  styles: [`
    .bf-lb { max-width: 900px; margin: 0 auto; padding: 24px; }
    .bf-lb__top { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .bf-lb__brand { display: flex; align-items: center; gap: 10px; }
    .bf-lb__brand mat-icon { font-size: 32px; width: 32px; height: 32px; color: #ff8f00; }
    .bf-lb__brand h1 { margin: 0; font-size: 24px; font-weight: 800; color: #1e293b; }

    .bf-lb__my-stats { display: flex; align-items: center; gap: 24px; background: linear-gradient(135deg, #f0f4ff, #e8eeff); border-radius: 16px; padding: 20px 24px; margin-bottom: 24px; border: 1px solid #c8d8e8; }
    .bf-lb__my-details { display: flex; gap: 24px; flex: 1; }
    .bf-lb__my-stat { display: flex; flex-direction: column; align-items: center; }
    .bf-lb__my-val { font-size: 24px; font-weight: 800; color: #405980; }
    .bf-lb__my-lbl { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }

    .bf-lb__table-wrap { background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,.06); }
    .bf-lb__table { width: 100%; border-collapse: collapse; }
    .bf-lb__table th { padding: 12px 16px; text-align: left; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .bf-lb__table td { padding: 14px 16px; font-size: 14px; border-bottom: 1px solid #f1f5f9; }
    .bf-lb__table tr:last-child td { border-bottom: none; }
    .bf-lb__row--me { background: #eff6ff; }
    .bf-lb__rank { font-weight: 800; color: #94a3b8; width: 40px; }
    .bf-lb__name { font-weight: 700; color: #1e293b; }
    .bf-lb__elo { font-weight: 800; color: #405980; }
    .bf-lb__wins { color: #22c55e; font-weight: 600; }
    .bf-lb__losses { color: #ef4444; font-weight: 600; }
    .bf-lb__winrate { color: #64748b; }

    .bf-lb__tier-badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
    .bf-lb__tier-badge--bronze { background: #fef3c7; color: #92400e; }
    .bf-lb__tier-badge--silver { background: #f1f5f9; color: #475569; }
    .bf-lb__tier-badge--gold { background: #fef3c7; color: #b45309; }
    .bf-lb__tier-badge--platinum { background: #e0f2fe; color: #0369a1; }
    .bf-lb__tier-badge--diamond { background: #ede9fe; color: #6d28d9; }

    .bf-lb__pagination { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 16px; }
    .bf-lb__page-info { font-size: 14px; color: #64748b; }
    .bf-lb__empty { text-align: center; padding: 48px 24px; color: #64748b; }
    .bf-lb__empty mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.3; }
    .bf-lb__empty h3 { margin: 12px 0 4px; }
    .bf-lb__loading { display: flex; justify-content: center; padding: 48px; }
  `]
})
export class BattlefieldLeaderboardComponent implements OnInit, OnDestroy {
  entries: BattlefieldLeaderboardEntry[] = [];
  myStats: BattlefieldStatsDto | null = null;
  loading = true;
  page = 1;
  limit = 50;
  total = 0;
  private subs: Subscription[] = [];

  constructor(private svc: InteractiveGameService) {}

  get totalPages() { return Math.max(1, Math.ceil(this.total / this.limit)); }

  ngOnInit() {
    this.load();
    this.loadMine();
  }

  ngOnDestroy() { this.subs.forEach(s => s.unsubscribe()); }

  load() {
    this.loading = true;
    this.subs.push(this.svc.getBattlefieldLeaderboard({ limit: this.limit, page: this.page }).subscribe({
      next: (res) => {
        this.entries = (res.entries || []).map((e: any) => ({ ...e, isMe: false }));
        this.total = res.total || 0;
        this.loading = false;
      },
      error: () => this.loading = false,
    }));
  }

  loadMine() {
    this.subs.push(this.svc.getBattlefieldStats().subscribe({
      next: (res) => {
        if (res?.stats) {
          this.myStats = res.stats;
          // Mark me in entries
          if (this.myStats) {
            this.entries = this.entries.map(e => ({
              ...e,
              isMe: e.studentId === (res as any).studentId,
            }));
          }
        }
      },
      error: () => {},
    }));
  }

  goPage(p: number) {
    this.page = p;
    this.load();
  }
}
