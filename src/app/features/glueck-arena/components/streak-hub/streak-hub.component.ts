import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { StreakFireComponent } from '../../shared/streak-fire/streak-fire.component';
import { StreakDashboard } from '../../glueck-arena.types';
import { NotificationService } from '../../../../services/notification.service';

@Component({
  selector: 'app-streak-hub',
  standalone: true,
  imports: [CommonModule, MaterialModule, StreakFireComponent],
  template: `
    <div *ngIf="data" class="sh">
      <div class="sh__hero">
        <app-streak-fire [streak]="data.currentStreak"></app-streak-fire>
        <div class="sh__stats">
          <span>Best: {{ data.bestStreak }}</span>
          <span>Freezes: {{ data.streakFreezes + data.walletFreezes }}</span>
        </div>
      </div>

      <mat-card class="sh__weekly">
        <mat-card-title>Weekly streak</mat-card-title>
        <mat-card-content>
          <p>{{ data.weeklyStreakDays }} / 5 days this week</p>
          <button mat-raised-button color="accent" [disabled]="data.weeklyStreakRewardClaimed || data.weeklyStreakDays < 5"
            (click)="claimWeekly()">
            Claim {{ data.weeklyRewardXp }} XP
          </button>
        </mat-card-content>
      </mat-card>

      <div class="sh__milestones">
        <div class="sh__ms" *ngFor="let m of data.milestones" [class.sh__ms--done]="m.claimed">
          <mat-icon>{{ m.unlocked ? 'local_fire_department' : 'lock' }}</mat-icon>
          <span>{{ m.days }}d</span>
          <button mat-stroked-button *ngIf="m.unlocked && !m.claimed" (click)="claimMilestone(m.days)">+{{ m.xpReward }} XP</button>
        </div>
      </div>

      <div class="sh__actions">
        <button mat-stroked-button (click)="repair()"><mat-icon>healing</mat-icon> Repair streak</button>
        <button mat-stroked-button (click)="showCalendar = !showCalendar"><mat-icon>calendar_month</mat-icon> Calendar</button>
      </div>

      <mat-dialog-content class="sh__cal" *ngIf="showCalendar">
        <div class="sh__cal-day" *ngFor="let d of data.calendar" [attr.data-status]="d.status">
          <span>{{ d.dateKey.slice(8) }}</span>
          <mat-icon>{{ statusIcon(d.status) }}</mat-icon>
        </div>
      </mat-dialog-content>
    </div>
    <mat-spinner *ngIf="loading" diameter="32"></mat-spinner>
  `,
  styles: [`
    .sh { padding: 16px 0; }
    .sh__hero { display: flex; align-items: center; gap: 24px; margin-bottom: 16px; }
    .sh__stats { display: flex; flex-direction: column; gap: 4px; color: #666; }
    .sh__weekly { margin-bottom: 16px; }
    .sh__milestones { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .sh__ms { display: flex; flex-direction: column; align-items: center; padding: 12px; border-radius: 12px; background: #f5f5f5; min-width: 72px; }
    .sh__ms--done { opacity: .6; }
    .sh__actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .sh__cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin-top: 12px; }
    .sh__cal-day { text-align: center; padding: 8px 4px; border-radius: 8px; background: #fafafa; font-size: 11px; }
    .sh__cal-day[data-status="played"] { background: #e8f5e9; }
    .sh__cal-day[data-status="frozen"] { background: #e3f2fd; }
    .sh__cal-day[data-status="repaired"] { background: #fff3e0; }
  `]
})
export class StreakHubComponent implements OnInit {
  data: StreakDashboard | null = null;
  loading = true;
  showCalendar = false;

  constructor(private svc: InteractiveGameService, private notify: NotificationService) {}

  ngOnInit() {
    this.svc.getStreakDashboard().subscribe({
      next: (r) => { this.data = r; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  statusIcon(s: string): string {
    return { played: 'check_circle', frozen: 'ac_unit', repaired: 'healing', missed: 'close' }[s] || 'circle';
  }

  claimWeekly() {
    this.svc.claimWeeklyStreak().subscribe({
      next: () => { this.notify.success('Weekly reward claimed!'); this.ngOnInit(); },
      error: (e) => this.notify.error(e?.error?.message || 'Failed')
    });
  }

  claimMilestone(days: number) {
    this.svc.claimStreakMilestone(days).subscribe({
      next: () => { this.notify.success('Milestone claimed!'); this.ngOnInit(); },
      error: (e) => this.notify.error(e?.error?.message || 'Failed')
    });
  }

  repair() {
    this.svc.repairStreak().subscribe({
      next: () => { this.notify.success('Streak repaired!'); this.ngOnInit(); },
      error: (e) => this.notify.error(e?.error?.message || 'Failed')
    });
  }
}
