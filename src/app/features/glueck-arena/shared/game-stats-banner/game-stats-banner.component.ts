import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { StudentGameStats } from '../../glueck-arena.types';

@Component({
  selector: 'app-game-stats-banner',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  template: `
    <div class="gsb" [class.gsb--hero]="variant === 'hero'" *ngIf="stats">
      <div class="gsb__item" *ngFor="let s of statItems">
        <div class="gsb__icon-wrap" [style.--accent]="s.color">
          <mat-icon>{{ s.icon }}</mat-icon>
        </div>
        <div class="gsb__text">
          <span class="gsb__val">{{ s.value }}</span>
          <span class="gsb__lbl">{{ s.label }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .gsb {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .gsb--hero .gsb__item {
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.18);
      backdrop-filter: blur(8px);
    }
    .gsb--hero .gsb__val { color: #fff; }
    .gsb--hero .gsb__lbl { color: rgba(255, 255, 255, 0.75); }
    .gsb--hero .gsb__icon-wrap {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
    }
    .gsb__item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 14px;
      background: #fff;
      border: 1px solid #e8ecf4;
      box-shadow: 0 2px 8px rgba(30, 58, 95, 0.06);
    }
    .gsb__icon-wrap {
      width: 40px; height: 40px; border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, var(--accent) 12%, white);
      color: var(--accent);
    }
    .gsb__icon-wrap mat-icon { font-size: 22px; width: 22px; height: 22px; }
    .gsb__text { display: flex; flex-direction: column; min-width: 0; }
    .gsb__val { font-size: 20px; font-weight: 800; color: #1e3a5f; line-height: 1.1; letter-spacing: -0.02em; }
    .gsb__lbl { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; margin-top: 2px; }
    @media (max-width: 920px) {
      .gsb { grid-template-columns: repeat(4, 1fr); }
    }
    @media (max-width: 620px) {
      .gsb { grid-template-columns: repeat(3, 1fr); }
      .gsb__val { font-size: 17px; }
    }
    @media (max-width: 420px) {
      .gsb { grid-template-columns: repeat(2, 1fr); }
      .gsb__val { font-size: 17px; }
    }
  `]
})
export class GameStatsBannerComponent {
  @Input() stats: StudentGameStats | null = null;
  @Input() variant: 'default' | 'hero' = 'default';

  get statItems() {
    const s = this.stats!;
    const accuracy = this.displayAccuracy(s);
    return [
      { icon: 'bolt', label: 'Total XP', value: s.totalXp ?? 0, color: '#f59e0b' },
      { icon: 'sports_esports', label: 'Completed', value: s.gamesCompleted ?? 0, color: '#3b82f6' },
      { icon: 'local_fire_department', label: 'Streak', value: s.currentStreak ?? 0, color: '#ef4444' },
      { icon: 'emoji_events', label: 'Best score', value: s.bestScore ?? 0, color: '#8b5cf6' },
      { icon: 'track_changes', label: 'Accuracy', value: `${accuracy}%`, color: '#10b981' },
    ];
  }

  private displayAccuracy(s: StudentGameStats): number {
    if (s.accuracy != null && !Number.isNaN(s.accuracy)) return Math.round(s.accuracy);
    if (s.totalAnswers && s.totalAnswers > 0) {
      return Math.round(((s.totalCorrectAnswers ?? 0) / s.totalAnswers) * 100);
    }
    return 0;
  }
}
