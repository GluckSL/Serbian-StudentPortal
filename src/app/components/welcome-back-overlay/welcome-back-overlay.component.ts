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
