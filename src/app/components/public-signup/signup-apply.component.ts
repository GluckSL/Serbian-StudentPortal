// Thin standalone page that hosts the signup wizard at /signup/apply

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { PublicSignupWizardComponent } from './public-signup-wizard.component';

@Component({
  selector: 'app-signup-apply',
  standalone: true,
  imports: [CommonModule, RouterModule, PublicSignupWizardComponent],
  template: `
    <div class="sa-page">
      <aside class="sa-hero">
        <div class="sa-hero__inner">
          <img src="assets/gluck-logo.png" alt="Glück Global" class="sa-hero__logo" width="40" height="40" />
          <h1 class="sa-hero__brand">Glück Global</h1>
          <p class="sa-hero__tagline">German Study Buddy</p>
        </div>
      </aside>
      <section class="sa-panel">
        <div class="sa-panel__inner">
          <app-public-signup-wizard (backToLogin)="goToLogin()"></app-public-signup-wizard>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .sa-page {
      display: grid;
      grid-template-columns: 1fr 1fr;
      min-height: 100vh;
    }
    .sa-hero {
      background: linear-gradient(135deg, #1a1b3a 0%, #3b1f7a 60%, #6c3fc5 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
    }
    .sa-hero__inner { text-align: center; padding: 32px; }
    .sa-hero__logo { border-radius: 50%; margin-bottom: 12px; }
    .sa-hero__brand { font-size: 28px; font-weight: 800; margin: 0 0 6px; }
    .sa-hero__tagline { font-size: 15px; color: rgba(255,255,255,.75); margin: 0; }
    .sa-panel {
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 32px 24px;
      background: #fff;
      overflow-y: auto;
    }
    .sa-panel__inner { width: 100%; max-width: 520px; }
    .sa-panel__inner:has(.sw-container--payment) { max-width: 100%; }
    @media (max-width: 768px) {
      .sa-page { grid-template-columns: 1fr; }
      .sa-hero { padding: 32px; min-height: 120px; }
    }
  `],
})
export class SignupApplyComponent {
  constructor(private router: Router) {}
  goToLogin(): void { this.router.navigateByUrl('/login'); }
}
