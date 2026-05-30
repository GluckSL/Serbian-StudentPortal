import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { TeamBattleStanding } from '../../glueck-arena.types';

@Component({
  selector: 'app-team-battle-standings',
  standalone: true,
  imports: [CommonModule, RouterModule, MaterialModule],
  template: `
    <div class="tbs">
      <div class="tbs__top">
        <a mat-stroked-button routerLink="/admin/glueck-arena/battlefield/team-battles" class="tbs__back">
          <mat-icon>arrow_back</mat-icon> Back
        </a>
        <h1><mat-icon>leaderboard</mat-icon> Team Battle Standings</h1>
      </div>

      <div class="tbs__table-wrap" *ngIf="!loading && standings.length > 0">
        <table class="tbs__table">
          <thead>
            <tr>
              <th class="tbs__col-rank">#</th>
              <th class="tbs__col-batch">Batch</th>
              <th class="tbs__col-num">Played</th>
              <th class="tbs__col-num">Won</th>
              <th class="tbs__col-num">Lost</th>
              <th class="tbs__col-num">Points For</th>
              <th class="tbs__col-num">Points Against</th>
              <th class="tbs__col-num">Win Rate</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let s of standings; let i = index"
              [class.tbs__row--top]="i === 0">
              <td class="tbs__col-rank">
                <span class="tbs__rank-badge" [class.tbs__rank-badge--gold]="i === 0"
                  [class.tbs__rank-badge--silver]="i === 1"
                  [class.tbs__rank-badge--bronze]="i === 2">{{ i + 1 }}</span>
              </td>
              <td class="tbs__col-batch">{{ s.batch }}</td>
              <td class="tbs__col-num">{{ s.played }}</td>
              <td class="tbs__col-num tbs__col--won">{{ s.won }}</td>
              <td class="tbs__col-num tbs__col--lost">{{ s.lost }}</td>
              <td class="tbs__col-num">{{ s.pointsFor }}</td>
              <td class="tbs__col-num">{{ s.pointsAgainst }}</td>
              <td class="tbs__col-num">{{ s.winRate * 100 }}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="tbs__empty" *ngIf="!loading && standings.length === 0">
        <mat-icon>leaderboard</mat-icon>
        <h3>No standings yet</h3>
        <p>Complete some team battles to see batch rankings here</p>
        <a mat-raised-button color="primary" routerLink="/admin/glueck-arena/battlefield/team-battles">
          <mat-icon>groups</mat-icon> Go to Team Battles
        </a>
      </div>

      <div class="tbs__loading" *ngIf="loading">
        <mat-spinner diameter="40"></mat-spinner>
        <span>Loading standings…</span>
      </div>
    </div>
  `,
  styles: [`
    .tbs { max-width: 900px; margin: 0 auto; padding: 24px; }
    .tbs__top { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
    .tbs__top h1 { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 24px; color: #1e293b; }
    .tbs__top h1 mat-icon { color: #f59e0b; }
    .tbs__back { font-size: 13px; }
    .tbs__table-wrap { overflow-x: auto; background: #fff; border-radius: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.06); border: 1px solid #e2e8f0; }
    .tbs__table { width: 100%; border-collapse: collapse; }
    .tbs__table th { padding: 14px 16px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; text-align: left; border-bottom: 2px solid #e2e8f0; background: #f8fafc; }
    .tbs__table td { padding: 14px 16px; font-size: 14px; color: #1e293b; border-bottom: 1px solid #f1f5f9; }
    .tbs__table tbody tr:hover { background: #f8fafc; }
    .tbs__row--top { background: #fffbeb !important; }
    .tbs__col-rank { width: 48px; }
    .tbs__col-num { text-align: center; font-variant-numeric: tabular-nums; }
    .tbs__col-batch { font-weight: 600; }
    .tbs__col--won { color: #16a34a; font-weight: 700; }
    .tbs__col--lost { color: #dc2626; }
    .tbs__rank-badge { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 999px; font-size: 13px; font-weight: 800; background: #f1f5f9; color: #475569; }
    .tbs__rank-badge--gold { background: #f59e0b; color: #fff; }
    .tbs__rank-badge--silver { background: #94a3b8; color: #fff; }
    .tbs__rank-badge--bronze { background: #d97706; color: #fff; }
    .tbs__empty { text-align: center; padding: 64px 24px; color: #64748b; }
    .tbs__empty mat-icon { font-size: 64px; width: 64px; height: 64px; opacity: 0.3; }
    .tbs__empty h3 { margin: 16px 0 8px; }
    .tbs__loading { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 64px; color: #64748b; }
  `]
})
export class TeamBattleStandingsComponent implements OnInit {
  standings: TeamBattleStanding[] = [];
  loading = true;

  constructor(private svc: InteractiveGameService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.svc.getTeamBattleStandings().subscribe({
      next: (res) => { this.standings = res.standings || []; this.loading = false; },
      error: () => { this.standings = []; this.loading = false; },
    });
  }
}
