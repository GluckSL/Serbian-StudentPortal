import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-streak-fire',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="sf" *ngIf="streak > 0" [class.sf--hot]="streak >= 7">
      <span class="sf__flame">🔥</span>
      <span class="sf__count">{{ streak }}</span>
      <span class="sf__lbl">dana u nizu</span>
    </span>
  `,
  styles: [`
    .sf { display: inline-flex; align-items: center; gap: 4px; padding: 4px 12px;
      background: linear-gradient(90deg, #fff3e0, #ffe0b2); border-radius: 20px; font-weight: 700; }
    .sf--hot { animation: sf-pulse 1.2s ease-in-out infinite; background: linear-gradient(90deg, #ffcc80, #ff9800); }
    .sf__flame { font-size: 18px; }
    .sf__count { color: #e65100; font-size: 16px; }
    .sf__lbl { font-size: 11px; color: #bf360c; font-weight: 500; }
    @keyframes sf-pulse { 0%,100%{ transform: scale(1); } 50%{ transform: scale(1.05); } }
  `]
})
export class StreakFireComponent {
  @Input() streak = 0;
}
