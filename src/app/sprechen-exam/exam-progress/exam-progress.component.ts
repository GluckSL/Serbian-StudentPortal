import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-exam-progress',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="exam-prog">
      <div
        *ngFor="let step of steps; let i = index"
        class="exam-prog__step"
        [class.exam-prog__step--done]="activeTeil > step.teil"
        [class.exam-prog__step--active]="activeTeil === step.teil"
      >
        <div class="exam-prog__dot">
          <span *ngIf="activeTeil > step.teil" class="exam-prog__check">✓</span>
          <span *ngIf="activeTeil <= step.teil">{{ i + 1 }}</span>
        </div>
        <span class="exam-prog__label">{{ step.label }}</span>
      </div>
    </div>
  `,
  styles: [`
    .exam-prog {
      display: flex;
      align-items: center;
      gap: 0;
      padding: 0 8px;
    }

    .exam-prog__step {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1;
      position: relative;
    }

    .exam-prog__step + .exam-prog__step::before {
      content: '';
      position: absolute;
      left: -16px;
      top: 50%;
      transform: translateY(-50%);
      width: 20px;
      height: 2px;
      background: #c5cae9;
    }

    .exam-prog__step--done .exam-prog__step + .exam-prog__step::before {
      background: #3949ab;
    }

    .exam-prog__dot {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 2px solid #c5cae9;
      background: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      color: #9fa8da;
      flex-shrink: 0;
      transition: all .2s;
    }

    .exam-prog__step--active .exam-prog__dot {
      border-color: #3949ab;
      background: #3949ab;
      color: #fff;
    }

    .exam-prog__step--done .exam-prog__dot {
      border-color: #43a047;
      background: #43a047;
      color: #fff;
    }

    .exam-prog__check { font-size: 13px; }

    .exam-prog__label {
      font-size: 12px;
      color: #9fa8da;
      font-weight: 600;
      white-space: nowrap;
    }

    .exam-prog__step--active .exam-prog__label {
      color: #3949ab;
    }

    .exam-prog__step--done .exam-prog__label {
      color: #43a047;
    }
  `],
})
export class ExamProgressComponent {
  @Input() activeTeil: 0 | 1 | 2 | 3 = 0;

  readonly steps = [
    { teil: 1, label: 'Teil 1' },
    { teil: 2, label: 'Teil 2' },
    { teil: 3, label: 'Teil 3' },
  ];
}
