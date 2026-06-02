import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import type { SprechenScores } from '../sprechen-exam.types';

@Component({
  selector: 'app-exam-summary',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  template: `
    <div class="exam-sum">
      <div class="exam-sum__header" [class.exam-sum__header--pass]="scores?.passed" [class.exam-sum__header--fail]="scores && !scores.passed">
        <mat-icon class="exam-sum__badge-icon">{{ scores?.passed ? 'emoji_events' : 'school' }}</mat-icon>
        <h2 class="exam-sum__title">{{ scores?.passed ? 'Bestanden' : 'Nicht bestanden' }}</h2>
        <p class="exam-sum__subtitle">Goethe A1 Sprechprüfung — Ergebnis</p>
      </div>

      <div class="exam-sum__scores" *ngIf="scores">
        <div class="exam-sum__hero">
          <div
            class="exam-sum__ring"
            [style.--p]="scores.total"
            [class.exam-sum__ring--pass]="scores.passed"
            [class.exam-sum__ring--fail]="!scores.passed"
          >
            <div class="exam-sum__ring-score">{{ scores.total | number:'1.0-1' }}</div>
            <div class="exam-sum__ring-sub">von 15 Punkten</div>
          </div>
        </div>

        <div class="exam-sum__row">
          <span class="exam-sum__row-label">Teil 1 — Sich vorstellen</span>
          <span class="exam-sum__row-score">{{ scores.teil1 | number:'1.0-1' }} / 3</span>
          <div class="exam-sum__bar"><div class="exam-sum__bar-fill" [style.width.%]="(scores.teil1 / 3) * 100"></div></div>
        </div>
        <div class="exam-sum__row">
          <span class="exam-sum__row-label">Teil 2 — Fragen & Antworten</span>
          <span class="exam-sum__row-score">{{ scores.teil2 | number:'1.0-1' }} / 6</span>
          <div class="exam-sum__bar"><div class="exam-sum__bar-fill" [style.width.%]="(scores.teil2 / 6) * 100"></div></div>
        </div>
        <div class="exam-sum__row">
          <span class="exam-sum__row-label">Teil 3 — Bitten</span>
          <span class="exam-sum__row-score">{{ scores.teil3 | number:'1.0-1' }} / 6</span>
          <div class="exam-sum__bar"><div class="exam-sum__bar-fill" [style.width.%]="(scores.teil3 / 6) * 100"></div></div>
        </div>

        <div class="exam-sum__total">
          <span>Gesamtpunktzahl</span>
          <span class="exam-sum__total-score">{{ scores.total | number:'1.0-1' }} / 15</span>
        </div>
      </div>

      <p class="exam-sum__note">
        Ihr Ergebnis wird von Ihrem Tutor überprüft. Bei Fragen wenden Sie sich bitte an Ihr Kursleiterteam.
      </p>

      <div class="exam-sum__actions">
        <button mat-stroked-button (click)="retake.emit()">
          <mat-icon>replay</mat-icon>
          Nochmal versuchen
        </button>
        <button mat-flat-button color="primary" (click)="exit.emit()">
          <mat-icon>home</mat-icon>
          Zurück zur Übersicht
        </button>
      </div>
    </div>
  `,
  styles: [`
    .exam-sum {
      max-width: 500px;
      margin: 0 auto;
      padding: 24px 16px;
      animation: fadeIn .4s ease;
    }

    @keyframes fadeIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }

    .exam-sum__header {
      text-align: center;
      border-radius: 12px;
      padding: 28px 20px 20px;
      margin-bottom: 24px;
      background: #e8f5e9;
    }

    .exam-sum__header--pass { background: #e8f5e9; }
    .exam-sum__header--fail { background: #fff3e0; }

    .exam-sum__badge-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: #43a047;
    }

    .exam-sum__header--fail .exam-sum__badge-icon { color: #fb8c00; }

    .exam-sum__title {
      font-size: 26px;
      font-weight: 800;
      color: #2e7d32;
      margin: 8px 0 4px;
    }

    .exam-sum__header--fail .exam-sum__title { color: #e65100; }

    .exam-sum__subtitle {
      font-size: 13px;
      color: #6a9e6d;
      margin: 0;
    }

    .exam-sum__scores {
      background: #fff;
      border-radius: 10px;
      border: 1px solid #e0e0e0;
      padding: 16px 20px;
      margin-bottom: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .exam-sum__hero {
      display: flex;
      justify-content: center;
      padding: 6px 0 4px;
    }

    .exam-sum__ring {
      width: 142px;
      height: 142px;
      border-radius: 999px;
      display: grid;
      place-content: center;
      text-align: center;
      background: radial-gradient(circle at 50% 40%, #fff 0%, #fff 48%, transparent 49%),
        conic-gradient(#3949ab calc((var(--p, 0) / 15) * 1turn), #e8eaf6 0);
      border: 10px solid #e8eaf6;
      box-shadow: 0 10px 24px rgba(17, 24, 39, 0.08);
      position: relative;
      overflow: hidden;
    }

    .exam-sum__ring--pass { border-color: rgba(67, 160, 71, 0.18); }
    .exam-sum__ring--fail { border-color: rgba(251, 140, 0, 0.18); }

    .exam-sum__ring-score {
      font-size: 34px;
      font-weight: 900;
      color: #1a237e;
      line-height: 1;
    }

    .exam-sum__ring-sub {
      margin-top: 6px;
      font-size: 12px;
      color: #607d8b;
      font-weight: 600;
    }

    .exam-sum__row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
    }

    .exam-sum__row-label {
      flex: 1 1 180px;
      font-size: 14px;
      color: #555;
    }

    .exam-sum__row-score {
      font-weight: 700;
      font-size: 14px;
      color: #3949ab;
      min-width: 48px;
      text-align: right;
    }

    .exam-sum__bar {
      flex-basis: 100%;
      height: 6px;
      background: #e8eaf6;
      border-radius: 3px;
      overflow: hidden;
    }

    .exam-sum__bar-fill {
      height: 100%;
      background: #3949ab;
      border-radius: 3px;
      transition: width .5s ease;
    }

    .exam-sum__total {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid #e0e0e0;
      padding-top: 12px;
      font-weight: 700;
      font-size: 16px;
      color: #212121;
    }

    .exam-sum__total-score { color: #3949ab; font-size: 20px; }

    .exam-sum__note {
      font-size: 12px;
      color: #9e9e9e;
      text-align: center;
      margin-bottom: 24px;
    }

    .exam-sum__actions {
      display: flex;
      gap: 12px;
      justify-content: center;
      flex-wrap: wrap;
    }
  `],
})
export class ExamSummaryComponent {
  @Input() scores: SprechenScores | null = null;
  @Output() retake = new EventEmitter<void>();
  @Output() exit = new EventEmitter<void>();
}
