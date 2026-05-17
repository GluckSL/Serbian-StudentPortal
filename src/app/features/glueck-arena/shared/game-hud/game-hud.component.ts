import { Component, Input, Output, EventEmitter, OnChanges, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';

@Component({
  selector: 'app-game-hud',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  template: `
    <div class="hud">
      <!-- Lives (hearts) -->
      <div class="hud__lives" *ngIf="showLives">
        <mat-icon
          *ngFor="let h of heartArray"
          class="hud__heart"
          [class.hud__heart--lost]="h > lives"
        >{{ h <= lives ? 'favorite' : 'favorite_border' }}</mat-icon>
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
    .hud { display: flex; align-items: center; gap: 12px; background: rgba(255,255,255,.95); border-radius: 16px; padding: 8px 16px; box-shadow: 0 2px 12px rgba(0,0,0,.1); flex-wrap: wrap; }
    .hud__lives { display: flex; gap: 2px; }
    .hud__heart { color: #e53935; font-size: 22px; width: 22px; height: 22px; transition: color .3s; }
    .hud__heart--lost { color: #e0e0e0; }
    .hud__score { display: flex; align-items: center; gap: 4px; font-size: 18px; font-weight: 700; color: #ff8f00; }
    .hud__score mat-icon { color: #ff8f00; font-size: 20px; width: 20px; height: 20px; }
    .hud__timer { display: flex; align-items: center; gap: 4px; font-size: 16px; font-weight: 600; color: #405980; }
    .hud__timer--urgent { color: #c62828; animation: timer-pulse 1s ease-in-out infinite; }
    .hud__timer mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .hud__level { background: #405980; color: #fff; padding: 3px 10px; border-radius: 10px; font-size: 13px; font-weight: 700; }
    .hud__progress { font-size: 13px; color: #888; margin-left: auto; }
    .hud__pause { margin-left: auto; }
    @keyframes timer-pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
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

  heartArray: number[] = [];

  ngOnChanges() {
    this.heartArray = Array.from({ length: this.maxLives }, (_, i) => i + 1);
  }

  ngOnDestroy() {}
}
