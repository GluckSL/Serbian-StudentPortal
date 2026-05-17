import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { AchievementDto } from '../../glueck-arena.types';

@Component({
  selector: 'app-achievements-page',
  standalone: true,
  imports: [CommonModule, RouterModule, MaterialModule],
  template: `
    <div class="ap" data-ga-theme>
      <button mat-icon-button routerLink="/glueck-arena"><mat-icon>arrow_back</mat-icon></button>
      <h1><mat-icon>emoji_events</mat-icon> Achievements</h1>
      <p class="ap__sub">{{ unlockedCount }} / {{ achievements.length }} unlocked</p>
      <div class="ap__grid">
        <div class="ap__badge" *ngFor="let a of achievements" [class.ap__badge--locked]="!a.isUnlocked">
          <mat-icon class="ap__icon">{{ a.icon }}</mat-icon>
          <h3>{{ a.title }}</h3>
          <p>{{ a.description }}</p>
          <span class="ap__xp" *ngIf="a.xpReward">+{{ a.xpReward }} XP</span>
          <mat-icon *ngIf="a.isUnlocked" class="ap__check">verified</mat-icon>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .ap { max-width: 900px; margin: 0 auto; padding: 24px 16px; }
    .ap h1 { display: flex; align-items: center; gap: 8px; color: var(--ga-primary, #405980); }
    .ap__sub { color: var(--ga-muted, #888); margin-bottom: 24px; }
    .ap__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
    .ap__badge { position: relative; background: var(--ga-card-bg, #fff); border-radius: 16px; padding: 20px; text-align: center;
      box-shadow: 0 2px 12px rgba(0,0,0,.08); transition: transform .2s; }
    .ap__badge:hover { transform: translateY(-4px); }
    .ap__badge--locked { opacity: .45; filter: grayscale(1); }
    .ap__icon { font-size: 40px; width: 40px; height: 40px; color: #ff8f00; }
    .ap__badge h3 { margin: 8px 0 4px; font-size: 16px; }
    .ap__badge p { font-size: 12px; color: #666; margin: 0; }
    .ap__xp { font-size: 12px; color: #ff8f00; font-weight: 700; }
    .ap__check { position: absolute; top: 8px; right: 8px; color: #2e7d32; }
  `]
})
export class AchievementsPageComponent implements OnInit {
  achievements: AchievementDto[] = [];

  get unlockedCount(): number { return this.achievements.filter(a => a.isUnlocked).length; }

  constructor(private svc: InteractiveGameService) {}

  ngOnInit() {
    this.svc.getAchievements().subscribe({
      next: (r) => { this.achievements = r.achievements || []; }
    });
  }
}
