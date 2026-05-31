import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { ArenaTournamentDto } from '../../glueck-arena.types';

@Component({
  selector: 'app-tournament-list',
  standalone: true,
  imports: [CommonModule, RouterModule, MaterialModule],
  template: `
    <div class="tl" [attr.data-ga-theme]="null">
      <div class="tl__head">
        <button mat-icon-button routerLink="/glueck-arena"><mat-icon>arrow_back</mat-icon></button>
        <h1><mat-icon>emoji_events</mat-icon> Tournaments</h1>
      </div>
      <mat-tab-group>
        <mat-tab label="Active">
          <div class="tl__grid" *ngIf="!loading">
            <mat-card *ngFor="let t of active" class="tl__card" [routerLink]="['/glueck-arena/tournaments', t._id]">
              <mat-card-title>{{ t.title }}</mat-card-title>
              <mat-card-subtitle>{{ t.gameType | titlecase }} · {{ t.status }}</mat-card-subtitle>
              <mat-card-content>
                <p><mat-icon>schedule</mat-icon> {{ t.startsAt | date:'medium' }}</p>
                <p>{{ t.participants?.length || 0 }} / {{ t.maxParticipants }} players</p>
                <p class="tl__rewards" *ngIf="t.rewards">🏆 {{ t.rewards.xpFirst }} XP</p>
                <div class="tl__countdown" *ngIf="countdown(t)">{{ countdown(t) }}</div>
              </mat-card-content>
            </mat-card>
            <p *ngIf="!active.length" class="tl__empty">No active tournaments — check back soon!</p>
          </div>
        </mat-tab>
        <mat-tab label="History">
          <div class="tl__grid">
            <mat-card *ngFor="let t of history" class="tl__card tl__card--past" [routerLink]="['/glueck-arena/tournaments', t._id]">
              <mat-card-title>{{ t.title }}</mat-card-title>
              <mat-card-subtitle>Finished · {{ t.endsAt | date:'shortDate' }}</mat-card-subtitle>
            </mat-card>
          </div>
        </mat-tab>
      </mat-tab-group>
      <mat-spinner *ngIf="loading" class="tl__spin"></mat-spinner>
    </div>
  `,
  styles: [`
    .tl { max-width: 900px; margin: 0 auto; padding: 16px; }
    .tl__head { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
    .tl__head h1 { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 22px; }
    .tl__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; padding: 16px 0; }
    .tl__card { cursor: pointer; transition: transform .2s, box-shadow .2s; border-radius: 16px !important; }
    .tl__card:hover { transform: translateY(-4px); box-shadow: 0 12px 28px rgba(64,89,128,.15); }
    .tl__card--past { opacity: .85; }
    .tl__rewards { color: #ff8f00; font-weight: 600; }
    .tl__countdown { font-size: 13px; color: #405980; font-weight: 700; margin-top: 8px; }
    .tl__empty { grid-column: 1/-1; text-align: center; color: #888; padding: 32px; }
    .tl__spin { margin: 48px auto; display: block; }
  `]
})
export class TournamentListComponent implements OnInit {
  active: ArenaTournamentDto[] = [];
  history: ArenaTournamentDto[] = [];
  loading = true;

  constructor(private svc: InteractiveGameService) {}

  ngOnInit() {
    this.svc.listTournaments().subscribe({
      next: r => { this.active = r.tournaments || []; this.loading = false; },
      error: () => { this.loading = false; }
    });
    this.svc.getTournamentHistory().subscribe({
      next: r => { this.history = r.tournaments || []; }
    });
  }

  countdown(t: ArenaTournamentDto): string {
    const ms = new Date(t.startsAt).getTime() - Date.now();
    if (ms <= 0) return t.status === 'active' ? 'Live now' : 'Starting soon';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `Starts in ${h}h ${m}m`;
  }
}
