import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { LoginStreakData } from '../../services/login-streak.service';

export interface StreakCardPopupData {
  streak: LoginStreakData;
}

@Component({
  selector: 'app-streak-card-popup',
  standalone: true,
  imports: [CommonModule, MatDialogModule],
  template: `
    <div class="sc">
      <button class="sc-close" (click)="close()" aria-label="Close">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>

      <div class="sc-glow"></div>

      <div class="sc-badge">
        <span class="sc-badge-icon">🔥</span>
      </div>

      <div class="sc-streak-num">{{ data.streak.currentStreak }}</div>
      <div class="sc-streak-label">Day Streak</div>

      <div class="sc-week">
        <div class="sc-day" *ngFor="let d of dayLabels; let i = index"
          [class.sc-day--done]="isDayFilled(i)"
          [class.sc-day--today]="isToday(i)">
          <div class="sc-day-dot">
            <svg *ngIf="isDayFilled(i)" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 7.5L5.5 10L11 4" stroke="#1a1025" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="sc-day-label">{{ d }}</span>
        </div>
      </div>

      <div class="sc-trophies">
        <span class="sc-trophy-icon">🏆</span>
        <span class="sc-trophy-count">{{ data.streak.totalTrophies }}</span>
        <span class="sc-trophy-text">Trophies</span>
      </div>

      <div class="sc-reward" *ngIf="showReward">
        <span>{{ rewardEmoji }}</span>
        <span>{{ rewardText }}</span>
      </div>

    </div>
  `,
  styles: [`
    .sc {
      background: linear-gradient(180deg, #0f0a1e 0%, #1a102e 30%, #231540 70%, #1a0f2e 100%);
      border-radius: 24px;
      padding: 40px 28px 20px;
      max-width: 340px;
      width: 88vw;
      color: #fff;
      text-align: center;
      position: relative;
      overflow: hidden;
      box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.15), 0 24px 80px rgba(0, 0, 0, 0.7);
      animation: scIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes scIn {
      from { opacity: 0; transform: scale(0.85) translateY(24px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    .sc-glow {
      position: absolute;
      top: -60px;
      left: 50%;
      transform: translateX(-50%);
      width: 240px;
      height: 240px;
      background: radial-gradient(circle, rgba(251, 191, 36, 0.12) 0%, transparent 70%);
      pointer-events: none;
    }
    .sc-close {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.08);
      border: none;
      border-radius: 50%;
      color: rgba(255, 255, 255, 0.4);
      cursor: pointer;
      transition: all 0.2s;
      z-index: 2;
    }
    .sc-close:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
    }
    .sc-badge {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: linear-gradient(135deg, #f59e0b, #d97706);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 12px;
      box-shadow: 0 0 0 4px rgba(251, 191, 36, 0.15), 0 8px 24px rgba(245, 158, 11, 0.25);
    }
    .sc-badge-icon {
      font-size: 1.6rem;
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2));
    }
    .sc-streak-num {
      font-size: 3.2rem;
      font-weight: 900;
      line-height: 1;
      background: linear-gradient(180deg, #fbbf24 0%, #f59e0b 60%, #b45309 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      letter-spacing: -0.02em;
    }
    .sc-streak-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.5);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 24px;
    }
    .sc-week {
      display: flex;
      justify-content: space-between;
      gap: 4px;
      margin-bottom: 24px;
      padding: 0 4px;
    }
    .sc-day {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      flex: 1;
    }
    .sc-day-dot {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.25s;
      background: transparent;
    }
    .sc-day--done .sc-day-dot {
      background: linear-gradient(135deg, #fbbf24, #f59e0b);
      border-color: #f59e0b;
      box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.15);
    }
    .sc-day--done .sc-day-dot svg path {
      stroke: #1a1025;
    }
    .sc-day--today .sc-day-dot {
      border-color: rgba(251, 191, 36, 0.5);
    }
    .sc-day--today.sc-day--done .sc-day-dot {
      box-shadow: 0 0 0 4px rgba(251, 191, 36, 0.25);
    }
    .sc-day-label {
      font-size: 0.62rem;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.35);
      font-weight: 600;
      letter-spacing: 0.04em;
    }
    .sc-trophies {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-bottom: 16px;
    }
    .sc-trophy-icon {
      font-size: 1rem;
    }
    .sc-trophy-count {
      font-size: 1.1rem;
      font-weight: 800;
      color: #fbbf24;
      line-height: 1;
    }
    .sc-trophy-text {
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.4);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: 500;
    }
    .sc-reward {
      background: rgba(251, 191, 36, 0.08);
      border: 1px solid rgba(251, 191, 36, 0.15);
      border-radius: 100px;
      padding: 8px 14px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.82rem;
      font-weight: 600;
      color: #fbbf24;
      margin-bottom: 16px;
    }
    .sc-footer {
      font-size: 0.7rem;
      color: rgba(255, 255, 255, 0.2);
      font-weight: 500;
      letter-spacing: 0.04em;
    }
  `],
})
export class StreakCardPopupComponent {
  readonly dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  get showReward(): boolean {
    return !!this.data.streak.weeklyRewardTier;
  }

  get rewardEmoji(): string {
    const tier = this.data.streak.weeklyRewardTier;
    if (tier === 'trophy') return '🏆';
    if (tier === 'gold') return '🥇';
    if (tier === 'silver') return '🥈';
    if (tier === 'bronze') return '🥉';
    return '';
  }

  get rewardText(): string {
    const tier = this.data.streak.weeklyRewardTier;
    if (tier === 'trophy') return 'Trophy Unlocked!';
    if (tier === 'gold') return 'Gold Unlocked!';
    if (tier === 'silver') return 'Silver Unlocked!';
    if (tier === 'bronze') return 'Bronze Unlocked!';
    return '';
  }

  isDayFilled(index: number): boolean {
    const dateStr = this.data.streak.weekDates?.[index];
    if (!dateStr) return false;
    return this.data.streak.loggedDates?.includes(dateStr) ?? false;
  }

  isToday(index: number): boolean {
    const today = new Date().toISOString().slice(0, 10);
    return this.data.streak.weekDates?.[index] === today;
  }

  constructor(
    private dialogRef: MatDialogRef<StreakCardPopupComponent>,
    @Inject(MAT_DIALOG_DATA) public data: StreakCardPopupData,
  ) {}

  close(): void {
    this.dialogRef.close();
  }
}
