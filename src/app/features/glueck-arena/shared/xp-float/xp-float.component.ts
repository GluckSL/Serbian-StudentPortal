import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-xp-float',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="xpf" [class.xpf--show]="show" aria-live="polite">
      <div class="xpf__confetti">
        <span class="xpf__c" style="--hue:50;--x:60px;--y:-50px;--r:90deg;--d:0s">●</span>
        <span class="xpf__c" style="--hue:20;--x:-55px;--y:-45px;--r:-80deg;--d:0.04s">●</span>
        <span class="xpf__c" style="--hue:0;--x:45px;--y:50px;--r:70deg;--d:0.08s">●</span>
        <span class="xpf__c" style="--hue:40;--x:-50px;--y:55px;--r:-60deg;--d:0.02s">●</span>
        <span class="xpf__c" style="--hue:10;--x:70px;--y:10px;--r:45deg;--d:0.06s">●</span>
        <span class="xpf__c" style="--hue:30;--x:-65px;--y:15px;--r:-45deg;--d:0.1s">●</span>
        <span class="xpf__c" style="--hue:55;--x:20px;--y:-60px;--r:120deg;--d:0.03s">●</span>
        <span class="xpf__c" style="--hue:15;--x:-25px;--y:-55px;--r:-110deg;--d:0.07s">●</span>
        <span class="xpf__c" style="--hue:45;--x:35px;--y:60px;--r:30deg;--d:0.09s">●</span>
        <span class="xpf__c" style="--hue:5;--x:-35px;--y:-35px;--r:-30deg;--d:0.05s">●</span>
        <span class="xpf__c" style="--hue:35;--x:0;--y:-70px;--r:180deg;--d:0.01s">●</span>
        <span class="xpf__c" style="--hue:25;--x:0;--y:65px;--r:-180deg;--d:0.11s">●</span>
      </div>
      +{{ xp }} XP
    </div>
  `,
  styles: [`
    .xpf { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%) scale(0);
      background: linear-gradient(135deg,#ff8f00,#ffc107); color: #fff;
      font-size: 28px; font-weight: 800; padding: 12px 28px; border-radius: 16px;
      box-shadow: 0 8px 32px rgba(255,143,0,.5);
      pointer-events: none; z-index: 9998; }
    .xpf--show { animation: xp-pop 0.8s ease-out forwards; }
    @keyframes xp-pop {
      0%   { opacity: 0; transform: translate(-50%,-50%) scale(0) rotate(-10deg); }
      30%  { opacity: 1; transform: translate(-50%,-50%) scale(1.2) rotate(3deg); }
      60%  { opacity: 1; transform: translate(-50%,-50%) scale(1) rotate(0); }
      100% { opacity: 0; transform: translate(-50%,-60%) scale(1) rotate(0); }
    }
    .xpf__confetti { position: absolute; inset: 0; pointer-events: none; }
    .xpf__c { position: absolute; top: 50%; left: 50%; font-size: 10px; color: hsl(calc(var(--hue)*1.8 + 20), 100%, 60%); opacity: 0; transform: translate(-50%,-50%); }
    .xpf--show .xpf__c { animation: burst 0.7s ease-out forwards; animation-delay: var(--d); }
    @keyframes burst {
      0%   { opacity: 0; transform: translate(-50%,-50%) scale(0.3); }
      20%  { opacity: 1; transform: translate(calc(-50% + var(--x)*0.4), calc(-50% + var(--y)*0.4)) scale(1.2) rotate(calc(var(--r)*0.4)); }
      60%  { opacity: 1; transform: translate(calc(-50% + var(--x)*0.8), calc(-50% + var(--y)*0.8)) scale(0.8) rotate(calc(var(--r)*0.8)); }
      100% { opacity: 0; transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y))) scale(0.2) rotate(var(--r)); }
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
