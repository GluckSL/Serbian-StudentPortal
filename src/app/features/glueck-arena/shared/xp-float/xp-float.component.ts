import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-xp-float',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="xpf" [class.xpf--show]="show" aria-live="polite">
      +{{ xp }} XP
    </div>
  `,
  styles: [`
    .xpf { position: fixed; bottom: 80px; right: 24px; background: #ff8f00; color: #fff;
      font-size: 22px; font-weight: 800; padding: 8px 20px; border-radius: 24px;
      box-shadow: 0 4px 16px rgba(255,143,0,.4); opacity: 0; transform: translateY(20px);
      pointer-events: none; z-index: 9998; transition: none; }
    .xpf--show { animation: xp-pop 1.4s ease-out forwards; }
    @keyframes xp-pop {
      0%   { opacity: 0; transform: translateY(20px) scale(.8); }
      20%  { opacity: 1; transform: translateY(-10px) scale(1.15); }
      60%  { opacity: 1; transform: translateY(-30px) scale(1); }
      100% { opacity: 0; transform: translateY(-60px) scale(.9); }
    }
  `]
})
export class XpFloatComponent implements OnChanges {
  @Input() xp = 5;
  @Input() trigger = 0;  // increment to replay
  show = false;
  private timer: any;

  ngOnChanges() {
    if (this.trigger > 0) {
      this.show = false;
      clearTimeout(this.timer);
      setTimeout(() => {
        this.show = true;
        this.timer = setTimeout(() => this.show = false, 1500);
      }, 20);
    }
  }
}
