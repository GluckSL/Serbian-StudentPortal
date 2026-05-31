import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { NotificationService } from '../../../../services/notification.service';
import { ArenaTournamentDto, ArenaBracketMatch } from '../../glueck-arena.types';

@Component({
  selector: 'app-tournament-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, MaterialModule],
  template: `
    <div class="td" *ngIf="tournament">
      <div class="td__head">
        <button mat-icon-button routerLink="/glueck-arena/tournaments"><mat-icon>arrow_back</mat-icon></button>
        <h1>{{ tournament.title }}</h1>
        <span class="td__badge" [attr.data-status]="tournament.status">{{ tournament.status }}</span>
      </div>

      <div class="td__meta">
        <p><mat-icon>schedule</mat-icon> {{ tournament.startsAt | date:'full' }}</p>
        <p><mat-icon>groups</mat-icon> {{ tournament.participantNames?.length || 0 }} / {{ tournament.maxParticipants }}</p>
        <p *ngIf="tournament.rewards"><mat-icon>stars</mat-icon> Rewards: {{ tournament.rewards.xpFirst }} / {{ tournament.rewards.xpSecond }} / {{ tournament.rewards.xpThird }} XP</p>
      </div>

      <div class="td__actions" *ngIf="canRegister">
        <button mat-raised-button color="primary" (click)="register()" [disabled]="registering">
          {{ registering ? 'Joining…' : 'Register' }}
        </button>
      </div>

      <h2>Bracket</h2>
      <div class="td__bracket">
        <div class="td__match" *ngFor="let m of tournament.bracket; let i = index" [attr.data-status]="m.status">
          <span class="td__match-num">Match {{ i + 1 }}</span>
          <div class="td__player" [class.td__player--win]="m.winnerId === m.playerAId">
            {{ m.playerAName || 'TBD' }}
          </div>
          <span class="td__vs">vs</span>
          <div class="td__player" [class.td__player--win]="m.winnerId === m.playerBId">
            {{ m.playerBName || 'BYE' }}
          </div>
          <a *ngIf="m.roomCode" [routerLink]="['/glueck-arena/spectate']" [queryParams]="{ code: m.roomCode }" mat-stroked-button>Watch</a>
        </div>
        <p *ngIf="!tournament.bracket?.length" class="td__empty">Bracket opens when tournament starts.</p>
      </div>

      <h2>Leaderboard</h2>
      <div class="td__lb">
        <div class="td__lb-row" *ngFor="let e of leaderboard; let i = index">
          <span>#{{ i + 1 }}</span>
          <strong>{{ e.name }}</strong>
          <span>{{ e.wins }} wins</span>
        </div>
      </div>
    </div>
    <mat-spinner *ngIf="loading" class="td__spin"></mat-spinner>
  `,
  styles: [`
    .td { max-width: 800px; margin: 0 auto; padding: 16px; }
    .td__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .td__head h1 { flex: 1; margin: 0; font-size: 22px; }
    .td__badge { padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; background: #e8edf5; }
    .td__badge[data-status="active"] { background: #e8f5e9; color: #2e7d32; }
    .td__meta { margin: 16px 0; color: #555; }
    .td__meta p { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
    .td__actions { margin-bottom: 24px; }
    .td__bracket { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
    .td__match { background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 2px 12px rgba(0,0,0,.08); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .td__match-num { font-size: 12px; color: #888; width: 100%; }
    .td__player { flex: 1; padding: 8px 12px; background: #f5f5f5; border-radius: 8px; font-weight: 600; min-width: 100px; }
    .td__player--win { background: #e8f5e9; color: #2e7d32; }
    .td__vs { color: #aaa; font-size: 12px; }
    .td__empty { color: #888; text-align: center; padding: 24px; }
    .td__lb-row { display: flex; gap: 16px; padding: 10px; border-bottom: 1px solid #eee; }
    .td__spin { margin: 48px auto; display: block; }
  `]
})
export class TournamentDetailComponent implements OnInit {
  tournament: ArenaTournamentDto | null = null;
  leaderboard: { name: string; wins: number }[] = [];
  loading = true;
  registering = false;
  canRegister = false;

  constructor(
    private route: ActivatedRoute,
    private svc: InteractiveGameService,
    private notify: NotificationService
  ) {}

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') || '';
    this.svc.getTournament(id).subscribe({
      next: r => {
        this.tournament = r.tournament;
        this.canRegister = ['registration', 'scheduled'].includes(r.tournament.status);
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
    this.svc.getTournamentLeaderboard(id).subscribe({
      next: r => { this.leaderboard = r.leaderboard || []; }
    });
  }

  register() {
    if (!this.tournament) return;
    this.registering = true;
    this.svc.registerTournament(this.tournament._id).subscribe({
      next: r => {
        this.tournament = r.tournament;
        this.notify.success('Registered!');
        this.registering = false;
        this.canRegister = false;
      },
      error: () => { this.registering = false; this.notify.error('Could not register'); }
    });
  }
}
