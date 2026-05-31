import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { QuestProgress } from '../../glueck-arena.types';
import { NotificationService } from '../../../../services/notification.service';

@Component({
  selector: 'app-quests-hub',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  template: `
    <div class="qh">
      <h2><mat-icon>flag</mat-icon> Quests & Missions</h2>
      <mat-tab-group>
        <mat-tab label="Daily" *ngIf="daily.length">
          <div class="qh__list">
            <mat-card *ngFor="let q of daily" class="qh__card">
              <mat-card-title>{{ q.title }}</mat-card-title>
              <mat-card-content>
                <p>{{ q.description }}</p>
                <mat-progress-bar mode="determinate" [value]="progressPct(q)"></mat-progress-bar>
                <span>{{ q.progress }} / {{ q.targetValue }}</span>
                <button mat-raised-button color="primary" *ngIf="q.isCompleted && !q.isClaimed" (click)="claim(q._id)">Claim</button>
                <mat-icon *ngIf="q.isClaimed" class="qh__done">check_circle</mat-icon>
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>
        <mat-tab label="Weekly" *ngIf="weekly.length">
          <div class="qh__list">
            <mat-card *ngFor="let q of weekly" class="qh__card">
              <mat-card-title>{{ q.title }}</mat-card-title>
              <mat-card-content>
                <mat-progress-bar mode="determinate" [value]="progressPct(q)"></mat-progress-bar>
                <button mat-raised-button *ngIf="q.isCompleted && !q.isClaimed" (click)="claim(q._id)">Claim {{ q.xpReward }} XP</button>
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>
        <mat-tab label="Seasonal" *ngIf="seasonal.length">
          <div class="qh__list">
            <mat-card *ngFor="let q of seasonal" class="qh__card qh__card--season">
              <mat-card-title>{{ q.title }}</mat-card-title>
              <mat-card-content>
                <mat-progress-bar mode="determinate" [value]="progressPct(q)"></mat-progress-bar>
                <button mat-stroked-button *ngIf="q.isCompleted && !q.isClaimed" (click)="claim(q._id)">Claim reward</button>
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .qh h2 { display: flex; align-items: center; gap: 8px; color: #405980; }
    .qh__list { display: flex; flex-direction: column; gap: 12px; padding: 16px 0; }
    .qh__card--season { border-left: 4px solid #ff8f00; }
    .qh__done { color: #2e7d32; }
  `]
})
export class QuestsHubComponent implements OnInit {
  daily: QuestProgress[] = [];
  weekly: QuestProgress[] = [];
  seasonal: QuestProgress[] = [];

  constructor(private svc: InteractiveGameService, private notify: NotificationService) {}

  ngOnInit() {
    this.svc.getQuests().subscribe({
      next: (r) => {
        this.daily = r.quests?.daily?.quests || [];
        this.weekly = r.quests?.weekly?.quests || [];
        this.seasonal = r.quests?.seasonal?.quests || [];
      }
    });
  }

  progressPct(q: QuestProgress) { return Math.min(100, (q.progress / q.targetValue) * 100); }

  claim(id: string) {
    this.svc.claimQuest(id).subscribe({
      next: () => { this.notify.success('Quest claimed!'); this.ngOnInit(); },
      error: (e) => this.notify.error(e?.error?.message || 'Failed')
    });
  }
}
