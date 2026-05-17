import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';

@Component({
  selector: 'app-adaptive-learning-hub',
  standalone: true,
  imports: [CommonModule, RouterModule, MaterialModule],
  template: `
    <div class="alh">
      <button mat-icon-button routerLink="/glueck-arena"><mat-icon>arrow_back</mat-icon></button>
      <h1><mat-icon>psychology</mat-icon> My Learning Path</h1>

      <mat-card *ngIf="data">
        <mat-card-title>Mastery · {{ data.masteryScore || data.profile?.masteryScore || 0 }}%</mat-card-title>
        <mat-card-content>
          <mat-chip [color]="riskColor">{{ data.retentionRisk || data.profile?.retentionRisk || 'low' }} retention risk</mat-chip>
          <button mat-stroked-button (click)="refresh()" [disabled]="loading">Refresh analysis</button>
        </mat-card-content>
      </mat-card>

      <mat-card *ngIf="data?.weakVocabulary?.length">
        <mat-card-title>Weak vocabulary</mat-card-title>
        <mat-card-content>
          <mat-chip *ngFor="let v of data.weakVocabulary">{{ v.label || v.key }} ({{ v.errorCount }})</mat-chip>
        </mat-card-content>
      </mat-card>

      <mat-card *ngIf="data?.weakGrammar?.length">
        <mat-card-title>Weak sentence patterns</mat-card-title>
        <mat-card-content>
          <p class="alh__grammar" *ngFor="let g of data.weakGrammar">{{ g.label || g.key }}</p>
        </mat-card-content>
      </mat-card>

      <h3>Recommended practice</h3>
      <div class="alh__rec" *ngFor="let g of data?.recommendations || []">
        <a [routerLink]="['/glueck-arena', g._id]">{{ g.title }}</a>
        <span>{{ g.gameType }}</span>
      </div>
    </div>
    <mat-spinner *ngIf="loading" diameter="40"></mat-spinner>
  `,
  styles: [`
    .alh { max-width: 720px; margin: 0 auto; padding: 24px; }
    .alh h1 { display: flex; align-items: center; gap: 8px; color: #405980; }
    mat-card { margin-bottom: 16px; }
    .alh__grammar { font-size: 13px; color: #555; margin: 4px 0; }
    .alh__rec { display: flex; justify-content: space-between; padding: 12px; background: #f5f5f5; border-radius: 8px; margin-bottom: 8px; }
  `]
})
export class AdaptiveLearningHubComponent implements OnInit {
  data: any = null;
  loading = true;

  constructor(private svc: InteractiveGameService) {}

  get riskColor(): 'primary' | 'warn' | 'accent' {
    const r = this.data?.retentionRisk || this.data?.profile?.retentionRisk;
    if (r === 'high') return 'warn';
    if (r === 'medium') return 'accent';
    return 'primary';
  }

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.svc.getAdaptiveLearning().subscribe({
      next: (r) => { this.data = r; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  refresh() {
    this.loading = true;
    this.svc.refreshAdaptiveLearning().subscribe({
      next: (r) => { this.data = r; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }
}
