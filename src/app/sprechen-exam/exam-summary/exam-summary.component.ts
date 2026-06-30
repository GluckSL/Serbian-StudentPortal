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
    <div class="exam-result">
      <div class="exam-result__card">
        <div class="exam-result__inner">
          <div class="exam-result__hero">
            <div
              class="exam-result__hero-icon"
              [class.exam-result__hero-icon--pass]="scores?.passed"
              [class.exam-result__hero-icon--fail]="scores && !scores.passed"
            >
              <mat-icon>{{ scores?.passed ? 'emoji_events' : 'school' }}</mat-icon>
            </div>
          </div>

          <p class="exam-result__label">{{ examLabel }}</p>
          <h1 class="exam-result__heading">Dein Ergebnis</h1>

          <div class="exam-result__score-block">
            <div class="exam-result__points-big">
              <span class="points-earned">{{ scores?.total ?? 0 | number:'1.0-1' }}</span>
              <span class="points-sep">/</span>
              <span class="points-total">{{ maxTotal }}</span>
              <span class="points-label">Punkte</span>
            </div>
          </div>

          <div class="exam-result__meta">
            <span
              class="exam-result__meta-item"
              [class.exam-result__meta-item--pass]="scores?.passed"
              [class.exam-result__meta-item--fail]="scores && !scores.passed"
            >
              <mat-icon>{{ scores?.passed ? 'check_circle' : 'cancel' }}</mat-icon>
              {{ scores?.passed ? 'Bestanden' : 'Nicht bestanden' }}
            </span>
          </div>

          <div class="exam-result__teile" *ngIf="scores">
            <div class="exam-result__teil-row">
              <span class="exam-result__teil-label">Teil 1</span>
              <span class="exam-result__teil-score">{{ scores.teil1 | number:'1.0-1' }} / {{ maxTeil1 }}</span>
            </div>
            <div class="exam-result__teil-row">
              <span class="exam-result__teil-label">Teil 2</span>
              <span class="exam-result__teil-score">{{ scores.teil2 | number:'1.0-1' }} / {{ maxTeil2 }}</span>
            </div>
            <div class="exam-result__teil-row">
              <span class="exam-result__teil-label">Teil 3</span>
              <span class="exam-result__teil-score">{{ scores.teil3 | number:'1.0-1' }} / {{ maxTeil3 }}</span>
            </div>
            <div class="exam-result__teil-row exam-result__teil-row--total">
              <span class="exam-result__teil-label">Gesamt</span>
              <span class="exam-result__teil-score exam-result__teil-score--total">{{ scores.total | number:'1.0-1' }} / {{ maxTotal }}</span>
            </div>
          </div>

          <p class="exam-result__note">
            Ihr Ergebnis wird von Ihrem Tutor überprüft. Bei Fragen wenden Sie sich bitte an Ihr Kursleiterteam.
          </p>

          <div class="exam-result__actions">
            <button class="exam-result__btn exam-result__btn--primary" type="button" (click)="retake.emit()">
              <mat-icon>replay</mat-icon>
              Nochmal versuchen
            </button>
            <button class="exam-result__btn exam-result__btn--outline" type="button" (click)="exit.emit()">
              <mat-icon>home</mat-icon>
              Zurück zur Übersicht
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .exam-result {
      min-height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px 16px;
    }

    .exam-result__card {
      width: 100%;
      max-width: 480px;
      animation: result-enter .45s cubic-bezier(0.22,1,0.36,1) both;
    }

    @keyframes result-enter {
      from { opacity: 0; transform: translateY(16px) scale(.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    .exam-result__card {
      position: relative;
      background: linear-gradient(180deg, #fff 0%, #fafbff 55%, #f8fafc 100%);
      border-radius: 24px;
      box-shadow:
        0 26px 70px rgba(15,23,42,0.14),
        0 12px 34px rgba(99,102,241,0.1),
        0 0 0 1px rgba(255,255,255,0.8) inset;
      overflow: hidden;
      border: 1px solid rgba(226,232,240,0.95);
    }

    .exam-result__inner {
      padding: 44px 36px 40px;
      text-align: center;
      overflow-y: auto;
    }

    .exam-result__hero-icon {
      width: 56px;
      height: 56px;
      margin: 0 auto 16px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(145deg, #eef2ff 0%, #e0e7ff 100%);
      border: 2px solid #c7d2fe;
      box-shadow: 0 8px 24px rgba(99,102,241,0.2);
    }

    .exam-result__hero-icon--pass {
      background: linear-gradient(145deg, #e8f5e9 0%, #c8e6c9 100%);
      border-color: #a5d6a7;
      box-shadow: 0 8px 24px rgba(76,175,80,0.2);
    }

    .exam-result__hero-icon--fail {
      background: linear-gradient(145deg, #fff3e0 0%, #ffe0b2 100%);
      border-color: #ffcc80;
      box-shadow: 0 8px 24px rgba(255,152,0,0.2);
    }

    .exam-result__hero-icon .mat-icon {
      font-size: 30px;
      width: 30px;
      height: 30px;
      color: #4f46e5;
    }

    .exam-result__hero-icon--pass .mat-icon { color: #2e7d32; }
    .exam-result__hero-icon--fail .mat-icon { color: #e65100; }

    .exam-result__label {
      font-size: .72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .12em;
      color: #6366f1;
      margin: 0 0 12px;
    }

    .exam-result__heading {
      font-size: 1.75rem;
      font-weight: 800;
      color: #0f172a;
      margin: 0 0 20px;
      letter-spacing: -.03em;
      line-height: 1.2;
    }

    .exam-result__score-block {
      margin-bottom: 20px;
    }

    .exam-result__points-big {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: 4px;
      flex-wrap: wrap;
    }

    .exam-result__points-big .points-earned {
      font-size: 3.5rem;
      font-weight: 800;
      color: #6366f1;
      line-height: 1;
      letter-spacing: -.02em;
    }

    .exam-result__points-big .points-sep {
      font-size: 2.5rem;
      font-weight: 700;
      color: #94a3b8;
      margin: 0 2px;
    }

    .exam-result__points-big .points-total {
      font-size: 2.25rem;
      font-weight: 700;
      color: #64748b;
    }

    .exam-result__points-big .points-label {
      font-size: 1rem;
      font-weight: 600;
      color: #94a3b8;
      margin-left: 6px;
    }

    .exam-result__meta {
      display: flex;
      gap: 16px;
      justify-content: center;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }

    .exam-result__meta-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: .9rem;
      color: #64748b;
      font-weight: 600;
    }

    .exam-result__meta-item .mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .exam-result__meta-item--pass { color: #047857; }
    .exam-result__meta-item--fail { color: #b91c1c; }

    .exam-result__teile {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-bottom: 24px;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
      background: #f8fafc;
    }

    .exam-result__teil-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 16px;
      background: #fff;
    }

    .exam-result__teil-row + .exam-result__teil-row {
      border-top: 1px solid #e2e8f0;
    }

    .exam-result__teil-row--total {
      background: #eef2ff;
      border-top: 2px solid #c7d2fe;
    }

    .exam-result__teil-label {
      font-size: .85rem;
      font-weight: 600;
      color: #334155;
    }

    .exam-result__teil-score {
      font-size: 1rem;
      font-weight: 700;
      color: #6366f1;
    }

    .exam-result__teil-score--total {
      font-size: 1.15rem;
      color: #4f46e5;
    }

    .exam-result__note {
      font-size: .8rem;
      color: #94a3b8;
      margin: 0 0 28px;
      line-height: 1.5;
    }

    .exam-result__actions {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .exam-result__btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 14px 24px;
      border-radius: 14px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all .2s;
      border: none;
      font-family: inherit;
    }

    .exam-result__btn .mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
    }

    .exam-result__btn--primary {
      background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
      color: #fff;
      box-shadow: 0 4px 18px rgba(99,102,241,0.4);
    }

    .exam-result__btn--primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(99,102,241,0.45);
    }

    .exam-result__btn--outline {
      background: #fff;
      color: #6366f1;
      border: 2px solid #c7d2fe;
    }

    .exam-result__btn--outline:hover {
      background: #eef2ff;
      border-color: #6366f1;
    }
  `],
})
export class ExamSummaryComponent {
  @Input() scores: SprechenScores | null = null;
  @Input() examFormat: string = 'A1';
  @Input() maxTeil1: number = 3;
  @Input() maxTeil2: number = 6;
  @Input() maxTeil3: number = 6;
  @Output() retake = new EventEmitter<void>();
  @Output() exit = new EventEmitter<void>();

  get examLabel(): string {
    return this.examFormat === 'A2' ? 'Goethe A2 — Sprechprüfung' : 'Goethe A1 — Sprechprüfung';
  }

  get maxTotal(): number {
    return this.maxTeil1 + this.maxTeil2 + this.maxTeil3;
  }
}
