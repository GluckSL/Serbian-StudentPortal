import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { ArenaProfileDto } from '../../glueck-arena.types';
import { StreakFireComponent } from '../../shared/streak-fire/streak-fire.component';

@Component({
  selector: 'app-arena-profile-page',
  standalone: true,
  imports: [CommonModule, RouterModule, MaterialModule, StreakFireComponent],
  template: `
    <div class="ap" *ngIf="data">
      <button mat-icon-button routerLink="/glueck-arena"><mat-icon>arrow_back</mat-icon></button>
      <div class="ap__header">
        <div class="ap__avatar" [style.backgroundImage]="data.profile?.avatarUrl ? 'url(' + data.profile.avatarUrl + ')' : null">
          <mat-icon *ngIf="!data.profile?.avatarUrl">person</mat-icon>
        </div>
        <div>
          <h1>{{ data.profile?.displayName || 'GlückArena Player' }}</h1>
          <p>Level {{ data.stats?.arenaLevel || 1 }} · {{ data.stats?.totalXp || 0 }} XP</p>
          <app-streak-fire [streak]="data.stats?.currentStreak || 0"></app-streak-fire>
        </div>
      </div>
      <div class="ap__grid">
        <mat-card><mat-card-title>Stats</mat-card-title>
          <mat-card-content>
            <p>Games: {{ data.stats?.gamesCompleted || 0 }}</p>
            <p>Accuracy: {{ data.stats?.accuracy || 0 }}%</p>
          </mat-card-content>
        </mat-card>
        <mat-card *ngIf="data.league"><mat-card-title>League</mat-card-title>
          <mat-card-content>{{ data.league.tier | titlecase }} · {{ data.league.weeklyXp }} XP this week</mat-card-content>
        </mat-card>
      </div>
      <h3>Recent activity</h3>
      <div class="ap__activity" *ngFor="let a of data.recentActivity">
        <strong>{{ $any(a).title }}</strong>
        <span>+{{ $any(a).xpEarned }} XP · {{ $any(a).accuracy }}%</span>
      </div>
      <button mat-stroked-button routerLink="/glueck-arena/achievements">View badges</button>
      <button mat-stroked-button routerLink="/glueck-arena/league">League board</button>
    </div>
    <mat-spinner *ngIf="!data" diameter="48"></mat-spinner>
  `,
  styles: [`
    .ap { max-width: 720px; margin: 0 auto; padding: 24px; }
    .ap__header { display: flex; gap: 20px; align-items: center; margin: 16px 0 24px; }
    .ap__avatar { width: 96px; height: 96px; border-radius: 50%; background: #e0e0e0 center/cover; display: flex; align-items: center; justify-content: center; border: 4px solid #ff8f00; }
    .ap__avatar mat-icon { font-size: 48px; width: 48px; height: 48px; color: #888; }
    .ap__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    .ap__activity { padding: 10px; background: #f5f5f5; border-radius: 8px; margin-bottom: 8px; display: flex; justify-content: space-between; }
    @media (max-width: 600px) { .ap__grid { grid-template-columns: 1fr; } }
  `]
})
export class ArenaProfilePageComponent implements OnInit {
  data: ArenaProfileDto | null = null;
  constructor(private svc: InteractiveGameService) {}
  ngOnInit() { this.svc.getArenaProfile().subscribe({ next: (r) => { this.data = r; } }); }
}
