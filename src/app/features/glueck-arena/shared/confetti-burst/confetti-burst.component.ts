import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-confetti-burst',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="cb" [class.cb--active]="active" aria-hidden="true">
      <div class="cb__bit" *ngFor="let b of bits" [style]="b"></div>
    </div>
  `,
  styles: [`
    .cb { position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 9999; overflow: hidden; }
    .cb__bit { position: absolute; width: 10px; height: 10px; border-radius: 2px; opacity: 0; }
    .cb--active .cb__bit { animation: confetti-fall 1.2s ease-out forwards; }
    @keyframes confetti-fall {
      0%   { transform: translateY(-20px) rotate(0deg); opacity: 1; }
      80%  { opacity: 1; }
      100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
    }
  `]
})
export class ConfettiBurstComponent implements OnChanges {
  @Input() active = false;
  bits: string[] = [];

  ngOnChanges() {
    if (this.active) this.generate();
  }

  generate() {
    const colors = ['#ff4e50', '#f9d423', '#56ab2f', '#2193b0', '#ee0979', '#ff6a00', '#a18cd1'];
    this.bits = Array.from({ length: 60 }, (_, i) => {
      const color = colors[i % colors.length];
      const left = Math.random() * 100;
      const delay = Math.random() * 0.6;
      const size = 6 + Math.random() * 10;
      return `left:${left}%;top:-20px;background:${color};width:${size}px;height:${size}px;animation-delay:${delay}s;--d:${delay}s`;
    });
  }
}
