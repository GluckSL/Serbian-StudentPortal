import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { DailyChallengeProgress } from '../../glueck-arena.types';
import { NotificationService } from '../../../../services/notification.service';
import { ConfettiBurstComponent } from '../confetti-burst/confetti-burst.component';

@Component({
  selector: 'app-daily-challenges-widget',
  standalone: true,
  imports: [CommonModule, MaterialModule, ConfettiBurstComponent],
  template: `
    <section class="dcw" *ngIf="challenges.length">
      <header class="dcw__head">
        <div class="dcw__title">
          <mat-icon>auto_awesome</mat-icon>
          <span>Daily quests</span>
        </div>
        <span class="dcw__reset">Resets at midnight</span>
      </header>
      <div class="dcw__grid">
        <article class="dcw__card" *ngFor="let c of challenges" [class.dcw__card--done]="c.isCompleted">
          <div class="dcw__ring" [style.--pct]="progressPct(c) + '%'">
            <span class="dcw__ring-inner">{{ progressPct(c) }}%</span>
          </div>
          <div class="dcw__body">
            <h4>{{ c.title }}</h4>
            <p>{{ c.description }}</p>
            <div class="dcw__bar"><span [style.width.%]="progressPct(c)"></span></div>
            <small>{{ c.progress }} / {{ c.targetValue }}</small>
          </div>
          <button *ngIf="c.isCompleted && !c.isClaimed" class="dcw__claim" (click)="claim(c)">
            +{{ c.xpReward }} XP
          </button>
          <span *ngIf="c.isClaimed" class="dcw__claimed"><mat-icon>check_circle</mat-icon></span>
        </article>
      </div>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </section>
  `,
  styles: [`
    .dcw {
      margin-bottom: 24px;
      padding: 20px 22px;
      border-radius: 18px;
      background: linear-gradient(145deg, #fff 0%, #f8fafc 100%);
      border: 1px solid #e2e8f0;
      box-shadow: 0 4px 24px rgba(30, 58, 95, 0.07);
    }
    .dcw__head {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 16px; padding: 0; flex-wrap: wrap; gap: 8px;
      background: none;
    }
    .dcw__title {
      display: flex; align-items: center; gap: 8px;
      font-size: 15px; font-weight: 700; color: #1e3a5f;
    }
    .dcw__title mat-icon { color: #6366f1; font-size: 22px; width: 22px; height: 22px; }
    .dcw__reset { font-size: 12px; color: #94a3b8; }
    .dcw__grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
    }
    .dcw__card {
      display: grid;
      grid-template-columns: 56px 1fr auto;
      gap: 12px;
      align-items: center;
      padding: 14px;
      border-radius: 14px;
      background: #fff;
      border: 1px solid #eef2f7;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .dcw__card--done { border-color: #86efac; background: #f0fdf4; }
    .dcw__ring {
      width: 52px; height: 52px; border-radius: 50%;
      background: conic-gradient(#6366f1 var(--pct), #e2e8f0 0);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .dcw__ring-inner {
      width: 40px; height: 40px; border-radius: 50%;
      background: #fff; display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 800; color: #4f46e5;
    }
    .dcw__body { min-width: 0; }
    .dcw__body h4 { margin: 0 0 2px; font-size: 14px; font-weight: 700; color: #1e293b; }
    .dcw__body p { margin: 0 0 8px; font-size: 12px; color: #64748b; line-height: 1.35;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .dcw__bar {
      height: 6px; border-radius: 999px; background: #e2e8f0; overflow: hidden; margin-bottom: 4px;
    }
    .dcw__bar span {
      display: block; height: 100%; border-radius: 999px;
      background: linear-gradient(90deg, #6366f1, #8b5cf6);
      transition: width 0.35s ease;
    }
    .dcw__body small { font-size: 11px; color: #94a3b8; font-weight: 600; }
    .dcw__claim {
      border: none; cursor: pointer; padding: 8px 12px; border-radius: 10px;
      font-size: 12px; font-weight: 700; color: #fff;
      background: linear-gradient(135deg, #f59e0b, #ea580c);
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.35);
      white-space: nowrap;
    }
    .dcw__claim:hover { filter: brightness(1.05); }
    .dcw__claimed mat-icon { color: #16a34a; font-size: 28px; width: 28px; height: 28px; }
  `]
})
export class DailyChallengesWidgetComponent implements OnInit {
  challenges: DailyChallengeProgress[] = [];
  showConfetti = false;

  constructor(private svc: InteractiveGameService, private notify: NotificationService) {}

  ngOnInit() {
    this.svc.getDailyChallenges().subscribe({
      next: (r) => { this.challenges = r.challenges || []; }
    });
  }

  progressPct(c: DailyChallengeProgress): number {
    return Math.min(100, Math.round((c.progress / c.targetValue) * 100));
  }

  claim(c: DailyChallengeProgress) {
    this.svc.claimDailyChallenge(c._id).subscribe({
      next: (r) => {
        c.isClaimed = true;
        this.showConfetti = true;
        setTimeout(() => this.showConfetti = false, 2000);
        this.notify.success(`+${r.xpReward} XP claimed!`);
      },
      error: () => this.notify.error('Could not claim reward')
    });
  }
}
