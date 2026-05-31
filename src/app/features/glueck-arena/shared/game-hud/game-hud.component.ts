import { Component, Input, Output, EventEmitter, OnChanges, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';

@Component({
  selector: 'app-game-hud',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  template: `
    <div class="hud">
      <!-- Lives as smile buddies (GlückArena vibe) -->
      <div class="hud__lives" *ngIf="showLives" role="group" aria-label="Lives remaining">
        <span
          *ngFor="let h of lifeSlots"
          class="hud__life"
          [class.hud__life--lost]="h > lives"
          [attr.aria-label]="h <= lives ? 'Life active' : 'Life used'"
        ><mat-icon class="hud__life-icon" aria-hidden="true">sentiment_very_satisfied</mat-icon></span>
      </div>

      <!-- Score -->
      <div class="hud__score">
        <mat-icon>star</mat-icon>
        <span>{{ score }}</span>
      </div>

      <!-- Timer -->
      <div class="hud__timer" *ngIf="timeLeft !== null" [class.hud__timer--urgent]="timeLeft <= 10">
        <mat-icon>timer</mat-icon>
        <span>{{ timeLeft }}s</span>
      </div>

      <!-- Level badge -->
      <div class="hud__level" *ngIf="level > 0">
        <span>LVL {{ level }}</span>
      </div>

      <!-- Progress -->
      <div class="hud__progress" *ngIf="total > 0">
        <span>{{ current }}/{{ total }}</span>
      </div>

      <!-- Pause -->
      <button mat-icon-button class="hud__pause" (click)="pause.emit()">
        <mat-icon>pause</mat-icon>
      </button>
    </div>
  `,
  styles: [`
    .hud {
      display: flex; align-items: center; gap: 12px;
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.92) 0%, rgba(30, 27, 75, 0.94) 100%);
      border-radius: 16px; padding: 8px 16px;
      box-shadow:
        0 0 0 1px rgba(56, 189, 248, 0.35),
        0 8px 28px rgba(0, 0, 0, 0.35),
        inset 0 1px 0 rgba(255, 255, 255, 0.06);
      flex-wrap: wrap;
    }
    .hud__lives { display: flex; gap: 6px; align-items: center; }
    .hud__life {
      display: inline-flex; align-items: center; justify-content: center;
      width: 34px; height: 34px;
      border-radius: 10px;
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.35);
      transition: transform .2s ease, opacity .25s ease, filter .25s ease;
    }
    .hud__life-icon {
      font-size: 20px !important; width: 20px !important; height: 20px !important;
      color: #fde047;
      filter: drop-shadow(0 0 6px rgba(253, 224, 71, 0.5));
    }
    .hud__life--lost {
      opacity: 0.45;
      filter: grayscale(0.85);
      border-color: rgba(148, 163, 184, 0.25);
      background: rgba(15, 23, 42, 0.5);
      transform: scale(0.92);
    }
    .hud__score { display: flex; align-items: center; gap: 4px; font-size: 18px; font-weight: 800; color: #fde047; text-shadow: 0 0 12px rgba(253, 224, 71, 0.45); }
    .hud__score mat-icon { color: #fde047; font-size: 20px; width: 20px; height: 20px; filter: drop-shadow(0 0 6px rgba(253, 224, 71, 0.5)); }
    .hud__timer { display: flex; align-items: center; gap: 4px; font-size: 16px; font-weight: 600; color: #7dd3fc; }
    .hud__timer--urgent { color: #fda4af; animation: timer-pulse 1s ease-in-out infinite; text-shadow: 0 0 10px rgba(251, 113, 133, 0.6); }
    .hud__timer mat-icon { font-size: 18px; width: 18px; height: 18px; color: #38bdf8; }
    .hud__level {
      background: linear-gradient(135deg, #7c3aed 0%, #2563eb 100%);
      color: #fff; padding: 3px 10px; border-radius: 10px; font-size: 13px; font-weight: 800;
      letter-spacing: 0.04em;
      box-shadow: 0 0 16px rgba(124, 58, 237, 0.45);
    }
    .hud__progress { font-size: 13px; color: #94a3b8; font-weight: 600; margin-left: auto; }
    .hud__pause { margin-left: auto; color: #e2e8f0 !important; }
    .hud__pause mat-icon { color: #e2e8f0; }
    @keyframes timer-pulse { 0%,100%{opacity:1} 50%{opacity:.55} }
  `]
})
export class GameHudComponent implements OnChanges, OnDestroy {
  @Input() lives = 3;
  @Input() maxLives = 3;
  @Input() score = 0;
  @Input() timeLeft: number | null = null;
  @Input() level = 0;
  @Input() current = 0;
  @Input() total = 0;
  @Input() showLives = true;
  @Output() pause = new EventEmitter<void>();

  lifeSlots: number[] = [];

  ngOnChanges() {
    this.lifeSlots = Array.from({ length: this.maxLives }, (_, i) => i + 1);
  }

  ngOnDestroy() {}
}
