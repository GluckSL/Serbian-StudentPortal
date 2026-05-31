import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-flashcards-placeholder',
  standalone: true,
  imports: [CommonModule, MaterialModule, RouterModule],
  template: `
    <div class="fp">
      <mat-icon class="fp__icon">style</mat-icon>
      <h2>Flashcards</h2>
      <p>Flashcard game type is coming soon. Stay tuned!</p>
      <button mat-raised-button color="primary" routerLink="/glueck-arena">Back to GlückArena</button>
    </div>
  `,
  styles: [`.fp{text-align:center;padding:64px 24px;}.fp__icon{font-size:72px;width:72px;height:72px;color:#e65100;display:block;margin:0 auto 16px;opacity:.4;}h2{font-size:24px;color:#2c3e50;}p{color:#888;}`]
})
export class FlashcardsPlaceholderComponent {}
