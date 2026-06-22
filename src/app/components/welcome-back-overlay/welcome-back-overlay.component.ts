import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { WelcomeBackPayload, WelcomeBackService } from '../../services/welcome-back.service';

@Component({
  selector: 'app-welcome-back-overlay',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './welcome-back-overlay.component.html',
  styleUrls: ['./welcome-back-overlay.component.css'],
})
export class WelcomeBackOverlayComponent implements OnInit, OnDestroy {
  visible = false;
  animating = false;
  closing = false;
  payload: WelcomeBackPayload | null = null;

  private sub?: Subscription;
  private showTimer?: ReturnType<typeof setTimeout>;

  constructor(private welcomeBack: WelcomeBackService) {}

  ngOnInit(): void {
    this.sub = this.welcomeBack.pending$.subscribe((payload) => {
      if (!payload) return;
      this.payload = payload;
      this.closing = false;
      this.visible = true;
      this.animating = false;

      if (this.showTimer) clearTimeout(this.showTimer);
      this.showTimer = setTimeout(() => {
        this.animating = true;
      }, 80);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    if (this.showTimer) clearTimeout(this.showTimer);
  }

  get message(): string {
    const days = this.payload?.daysSince ?? 2;
    if (days >= 3) {
      return 'We are so happy to have you back! Let\'s catch up on your classes and keep moving toward your German dream — every session brings you closer.';
    }
    return 'Great to see you again! Let\'s pick up where you left off and stay on track with your batch.';
  }

  dismiss(): void {
    if (this.closing) return;
    this.closing = true;
    this.animating = false;
    setTimeout(() => {
      this.visible = false;
      this.closing = false;
      this.payload = null;
      this.welcomeBack.dismiss();
    }, 280);
  }
}
