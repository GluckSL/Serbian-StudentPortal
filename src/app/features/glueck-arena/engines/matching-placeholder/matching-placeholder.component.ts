import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-matching-placeholder',
  standalone: true,
  imports: [CommonModule, MaterialModule, RouterModule],
  template: `
    <div class="mp">
      <mat-icon class="mp__icon">extension</mat-icon>
      <h2>Igra sparivanja</h2>
      <p>Ova vrsta igre uskoro dolazi. Pratite nas za novosti!</p>
      <button mat-raised-button color="primary" routerLink="/glueck-arena">Nazad na GlückArenu</button>
    </div>
  `,
  styles: [`.mp{text-align:center;padding:64px 24px;}.mp__icon{font-size:72px;width:72px;height:72px;color:#6a1b9a;display:block;margin:0 auto 16px;opacity:.4;}h2{font-size:24px;color:#2c3e50;}p{color:#888;}`]
})
export class MatchingPlaceholderComponent {}
