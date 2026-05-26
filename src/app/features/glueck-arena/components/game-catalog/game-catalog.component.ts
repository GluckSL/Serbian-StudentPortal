import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { DigitalExerciseService } from '../../../../services/digital-exercise.service';
import { GameSet, StudentGameStats, CatalogFilters, GameType, LeaderboardEntry } from '../../glueck-arena.types';
import { GameStatsBannerComponent } from '../../shared/game-stats-banner/game-stats-banner.component';
import { DailyChallengesWidgetComponent } from '../../shared/daily-challenges-widget/daily-challenges-widget.component';

@Component({
  selector: 'app-game-catalog',
  standalone: true,
  imports: [
    CommonModule, RouterModule, FormsModule, MaterialModule,
    GameStatsBannerComponent, DailyChallengesWidgetComponent
  ],
  template: `
    <div class="arena">

      <div *ngIf="accessChecked && !hasArenaAccess" class="arena__locked">
        <div class="arena__locked-icon"><mat-icon>lock</mat-icon></div>
        <h2>GlückArena isn’t open for your class yet</h2>
        <p>Your teacher hasn’t assigned any games to your batch. You’ll see this area once a game is published for you.</p>
      </div>

      <ng-container *ngIf="hasArenaAccess">

        <!-- Hero -->
        <header class="arena-hero">
          <div class="arena-hero__glow"></div>
          <div class="arena-hero__top">
            <div class="arena-hero__brand">
              <span class="arena-hero__logo"><mat-icon>sports_esports</mat-icon></span>
              <div>
                <h1>GlückArena</h1>
                <p>Level up your German — play, earn XP, climb the ranks</p>
              </div>
            </div>
            <a routerLink="/glueck-arena/leaderboard" class="arena-hero__lb-btn">
              <mat-icon>leaderboard</mat-icon>
              <span>Leaderboard</span>
            </a>
          </div>

          <app-game-stats-banner *ngIf="myStats" [stats]="myStats" variant="hero"></app-game-stats-banner>
        </header>

        <div class="arena-layout">
        <div class="arena-left-col">
          <div class="podium-card">
            <div class="podium-heading">
              <mat-icon>emoji_events</mat-icon> Top Students
            </div>
            <div class="podium">
              <div class="podium__place podium__place--2">
                <div class="podium__avatar">
                  <img *ngIf="podiumPlayer(1)?.avatarUrl" [src]="podiumPlayer(1)!.avatarUrl" (error)="clearPodiumAvatar(podiumPlayer(1))" />
                  <span *ngIf="!podiumPlayer(1)?.avatarUrl">{{ podiumInitial(podiumPlayer(1)) }}</span>
                </div>
                <div class="podium__bar">
                  🥈
                  <span class="podium__xp">{{ podiumXp(podiumPlayer(1)) }}</span>
                </div>
                <span class="podium__name">{{ podiumName(podiumPlayer(1)) }}</span>
              </div>
              <div class="podium__place podium__place--1">
                <div class="podium__avatar">
                  <img *ngIf="podiumPlayer(0)?.avatarUrl" [src]="podiumPlayer(0)!.avatarUrl" (error)="clearPodiumAvatar(podiumPlayer(0))" />
                  <span *ngIf="!podiumPlayer(0)?.avatarUrl">{{ podiumInitial(podiumPlayer(0)) }}</span>
                </div>
                <div class="podium__bar">
                  🥇
                  <span class="podium__xp">{{ podiumXp(podiumPlayer(0)) }}</span>
                </div>
                <span class="podium__name">{{ podiumName(podiumPlayer(0)) }}</span>
              </div>
              <div class="podium__place podium__place--3">
                <div class="podium__avatar">
                  <img *ngIf="podiumPlayer(2)?.avatarUrl" [src]="podiumPlayer(2)!.avatarUrl" (error)="clearPodiumAvatar(podiumPlayer(2))" />
                  <span *ngIf="!podiumPlayer(2)?.avatarUrl">{{ podiumInitial(podiumPlayer(2)) }}</span>
                </div>
                <div class="podium__bar">
                  🥉
                  <span class="podium__xp">{{ podiumXp(podiumPlayer(2)) }}</span>
                </div>
                <span class="podium__name">{{ podiumName(podiumPlayer(2)) }}</span>
              </div>
            </div>
          </div>
        <app-daily-challenges-widget></app-daily-challenges-widget>
        </div>

        <!-- Games section -->
        <section class="arena-games">
          <!-- <div class="arena-games__head">
            <span class="arena-games__count" *ngIf="!loading">{{ pagination.total }} available</span>
          </div> -->

          <!-- <div class="arena-filters">
            <div class="arena-filters__search">
              <mat-icon>search</mat-icon>
              <input type="search" [(ngModel)]="filters.search" (ngModelChange)="onSearch()"
                placeholder="Search by title or topic…" aria-label="Search games">
            </div>
            <div class="arena-filters__dropdown-wrap">
              <div class="arena-filters__dropdown" (click)="typeOpen = !typeOpen">
                <span>{{ getTypeLabel(filters.gameType) }}</span>
                <mat-icon>expand_more</mat-icon>
              </div>
              <div class="arena-filters__dropdown-menu" *ngIf="typeOpen">
                <div class="arena-filters__dropdown-item" (click)="setType('')">All types</div>
                <div class="arena-filters__dropdown-item" (click)="setType('scramble_rush')">Scramble Rush</div>
                <div class="arena-filters__dropdown-item" (click)="setType('sentence_builder')">Sentence Builder</div>
                <div class="arena-filters__dropdown-item" (click)="setType('matching')">Matching</div>
                <div class="arena-filters__dropdown-item" (click)="setType('flashcards')">Flashcards</div>
              </div>
            </div>
            <div class="arena-filters__dropdown-wrap">
              <div class="arena-filters__dropdown" (click)="levelOpen = !levelOpen">
                <span>{{ getLevelLabel(filters.level) }}</span>
                <mat-icon>expand_more</mat-icon>
              </div>
              <div class="arena-filters__dropdown-menu" *ngIf="levelOpen">
                <div class="arena-filters__dropdown-item" (click)="setLevel('')">All levels</div>
                <div class="arena-filters__dropdown-item" *ngFor="let l of cefrLevels" (click)="setLevel(l)">{{ l }}</div>
              </div>
            </div>
            <div class="arena-filters__dropdown-wrap">
              <div class="arena-filters__dropdown" (click)="diffOpen = !diffOpen">
                <span>{{ getDiffLabel(filters.difficulty) }}</span>
                <mat-icon>expand_more</mat-icon>
              </div>
              <div class="arena-filters__dropdown-menu" *ngIf="diffOpen">
                <div class="arena-filters__dropdown-item" (click)="setDiff('')">All</div>
                <div class="arena-filters__dropdown-item" (click)="setDiff('Beginner')">Beginner</div>
                <div class="arena-filters__dropdown-item" (click)="setDiff('Intermediate')">Intermediate</div>
                <div class="arena-filters__dropdown-item" (click)="setDiff('Advanced')">Advanced</div>
              </div>
            </div>
          </div> -->

          <div *ngIf="loading" class="arena-grid">
            <div class="arena-card arena-card--skel" *ngFor="let _ of [1,2,3,4,5,6]"></div>
          </div>

          <div *ngIf="!loading && sets.length" class="arena-grid">
            <article class="arena-card" *ngFor="let set of sets"
              (click)="openGame(set)" role="button" tabindex="0" (keyup.enter)="openGame(set)">
              <div class="arena-card__visual" [style.background]="getTypeColor(set.gameType)">
                <img *ngIf="getThumbnailUrl(set) && !brokenThumbnails.has(set._id)" [src]="getThumbnailUrl(set)" alt="" class="arena-card__img" (error)="onThumbnailError(set)">
                <mat-icon *ngIf="!getThumbnailUrl(set) || brokenThumbnails.has(set._id)" class="arena-card__glyph">{{ set.icon || 'sports_esports' }}</mat-icon>
                <span class="arena-card__xp">+{{ set.xpReward }} XP</span>
              </div>
              <div class="arena-card__content">
                <div class="arena-card__tags">
                  <span class="tag tag--type">{{ formatType(set.gameType) }}</span>
                  <span class="tag" [class]="'tag--' + (set.difficulty | lowercase)">{{ set.difficulty }}</span>
                  <span class="tag tag--level" *ngIf="set.level">{{ set.level }}</span>
                </div>
                <h3>{{ set.title }}</h3>
                <p>{{ set.description }}</p>
                <div class="arena-card__meta">
                  <span><mat-icon>schedule</mat-icon> {{ set.estimatedDurationMinutes }} min</span>
                  <span><mat-icon>quiz</mat-icon> {{ set.questionCount }} questions</span>
                </div>
                <div class="arena-card__record" *ngIf="set.studentProgress?.timesPlayed">
                  <mat-icon>workspace_premium</mat-icon>
                  Best {{ set.studentProgress?.bestScore ?? 0 }} pts · {{ set.studentProgress?.timesPlayed }}× played
                </div>
              </div>
              <button type="button" class="arena-card__play" (click)="$event.stopPropagation(); playGame(set)">
                <mat-icon>play_arrow</mat-icon> Play now
              </button>
            </article>
          </div>

          <div *ngIf="!loading && !sets.length" class="arena-empty">
            <mat-icon>extension</mat-icon>
            <h3>No games match your filters</h3>
            <p>Try clearing filters or check back later for new modules.</p>
            <button mat-stroked-button (click)="clearFilters()">Clear filters</button>
          </div>

          <mat-paginator
            *ngIf="pagination.total > pagination.limit"
            [length]="pagination.total"
            [pageSize]="pagination.limit"
            [pageIndex]="pagination.page - 1"
            (page)="onPage($event)"
            class="arena-paginator"
          ></mat-paginator>
        </section>
        </div>
      </ng-container>
    </div>
  `,
  styles: [`
    .arena {
      --arena-bg: #fff;
      --arena-surface: #ffffff;
      --arena-text: #0f172a;
      --arena-muted: #64748b;
      --arena-border: #e2e8f0;
      --arena-hero-from: #0f2744;
      --arena-hero-to: #1e4d7a;
      margin: 0 auto;
      max-width: 1500px;
      padding: 20px 20px 48px;
      min-height: 60vh;
      background: var(--arena-bg);
      border-radius: 0 0 14px 14px;
      border: 1px solid #e2e8f0;
    }
    .arena__locked {
      text-align: center; padding: 80px 24px; border-radius: 24px;
      background: var(--arena-surface); border: 1px dashed var(--arena-border);
    }
    .arena__locked-icon {
      width: 72px; height: 72px; margin: 0 auto 20px; border-radius: 50%;
      background: #f1f5f9; display: flex; align-items: center; justify-content: center;
    }
    .arena__locked-icon mat-icon { font-size: 36px; width: 36px; height: 36px; color: #94a3b8; }
    .arena__locked h2 { margin: 0 0 10px; color: var(--arena-text); font-size: 22px; }
    .arena__locked p { color: var(--arena-muted); max-width: 400px; margin: 0 auto; line-height: 1.55; }

    .arena-hero {
      position: relative; border-radius: 14px;
      margin-bottom: 20px;
      background: #fff;
      padding: 20px;
      border: 1px solid var(--arena-border);
    }
    .arena-hero__top {
      display: flex; justify-content: space-between; align-items: flex-start;
      gap: 16px; margin-bottom: 22px; position: relative; z-index: 1;
    }
    .arena-hero__brand { display: flex; gap: 16px; align-items: center; }
    .arena-hero__logo {
      width: 56px; height: 56px; border-radius: 16px; flex-shrink: 0;
      background: #f1f5f9; display: flex; align-items: center; justify-content: center;
      border: 1px solid var(--arena-border);
    }
    .arena-hero__logo mat-icon { font-size: 32px; width: 32px; height: 32px; color: var(--arena-text); }
    .arena-hero__lb-btn {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 18px; border-radius: 12px; text-decoration: none;
      font-size: 14px; font-weight: 600; color: var(--arena-text);
      background: #fff; border: 1px solid var(--arena-border);
      transition: box-shadow 0.15s, border-color 0.15s; flex-shrink: 0;
    }
    .arena-hero__lb-btn mat-icon { font-size: 20px; width: 20px; height: 20px; color: #405980; }
    .arena-hero__lb-btn:hover { border-color: #93c5fd; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15); }
    .arena-hero h1 {
      margin: 0; font-size: 28px; font-weight: 800; color: var(--arena-text);
      letter-spacing: -0.03em; line-height: 1.15;
    }
    .arena-hero p { margin: 6px 0 0; font-size: 14px; color: var(--arena-muted); max-width: 360px; }
    ::ng-deep .arena-hero .gsb--hero { margin-bottom: 0; }
    @media (min-width: 1700px) {
      .arena-hero .gsb--hero { grid-template-columns: repeat(7, 1fr) !important; margin-top: 30px; }
    }
    @media (min-width: 1400px) and (max-width: 1699px) {
      .arena-hero .gsb--hero { grid-template-columns: repeat(6, 1fr) !important; margin-top: 30px; }
    }
    @media (max-width: 920px) {
      .arena-hero .gsb--hero { grid-template-columns: repeat(4, 1fr) !important; }
    }
    @media (max-width: 620px) {
      .arena-hero .gsb--hero { grid-template-columns: repeat(3, 1fr) !important; }
    }
    @media (max-width: 420px) {
      .arena-hero .gsb--hero { grid-template-columns: repeat(2, 1fr) !important; }
    }

    .arena-layout {
      display: grid;
      grid-template-columns: 0.3fr 0.7fr;
      gap: 20px;
      align-items: start;
    }
    @media (max-width: 1000px) {
      .arena-layout { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 640px) {
      .arena-layout { grid-template-columns: 1fr; }
    }
    :host ::ng-deep .arena-layout .dcw__grid {
      grid-template-columns: 1fr;
    }

    .arena-left-col { display: flex; flex-direction: column; gap: 16px; }

    .podium-card { background: #fff; border: 1px solid #e8ecf4; border-radius: 16px; padding: 20px 12px 16px; }
    .podium-heading { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 700; color: #405980; margin-bottom: 16px; padding: 0 4px; }
    .podium-heading mat-icon { font-size: 22px; width: 22px; height: 22px; color: #f59e0b; }
    .podium { display: flex; align-items: flex-end; justify-content: center; gap: 8px; }
    .podium__place { display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .podium__avatar { width: 44px; height: 44px; border-radius: 50%; background: #e8edf5; color: #405980; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; overflow: hidden; flex-shrink: 0; }
    .podium__avatar img { width: 100%; height: 100%; object-fit: cover; }
    .podium__bar { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; width: 76px; border-radius: 10px 10px 0 0; font-size: 24px; padding: 6px 0; }
    .podium__xp { font-size: 14px; font-weight: 800; color: #fff; }
    .podium__name { font-size: 12px; font-weight: 600; color: #555; max-width: 80px; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .podium__place--1 .podium__bar { height: 110px; background: linear-gradient(180deg,#ffd700,#ffb300); }
    .podium__place--2 .podium__bar { height: 80px; background: linear-gradient(180deg,#b0bec5,#90a4ae); }
    .podium__place--3 .podium__bar { height: 60px; background: linear-gradient(180deg,#cd7f32,#a0522d); }

    .arena-games__head {
      display: flex; justify-content: flex-end;
      margin-bottom: 16px;
    }
    .arena-games__head h2 {
      margin: 0; font-size: 20px; font-weight: 800; color: var(--arena-text);
      display: flex; align-items: center; gap: 8px; letter-spacing: -0.02em;
    }
    .arena-games__head h2 mat-icon { color: #6366f1; }
    .arena-games__count { font-size: 13px; color: var(--arena-muted); font-weight: 600; }

    .arena-filters {
      display: flex; flex-wrap: wrap; gap: 12px; align-items: center;
      margin-bottom: 22px; padding: 14px 16px; position: relative;
      background: var(--arena-surface); border-radius: 16px;
      border: 1px solid var(--arena-border);
    }
    .arena-filters__search {
      flex: 1; min-width: 200px; display: flex; align-items: center; gap: 10px;
      padding: 0 14px; height: 48px; border-radius: 12px;
      background: #f8fafc; border: 1px solid var(--arena-border);
    }
    .arena-filters__search mat-icon { color: #94a3b8; }
    .arena-filters__search input {
      flex: 1; border: none; background: transparent; outline: none;
      font-size: 14px; color: var(--arena-text);
    }
    .arena-filters__select { width: 140px; margin: 0 !important; }
    .arena-filters__dropdown-wrap { position: relative; }
    .arena-filters__dropdown {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 0 14px; height: 48px; min-width: 130px; border-radius: 12px;
      background: #f8fafc; border: 1px solid var(--arena-border); cursor: pointer;
      font-size: 14px; color: var(--arena-text);
    }
    .arena-filters__dropdown mat-icon { color: #94a3b8; transition: transform 0.2s; }
    .arena-filters__dropdown:hover { border-color: #94a3b8; }
    .arena-filters__dropdown-menu {
      position: absolute; top: 100%; left: 0; z-index: 100; margin-top: 6px; min-width: 100%;
      background: var(--arena-surface); border: 1px solid var(--arena-border);
      border-radius: 12px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.15);
      overflow: hidden;
    }
    .arena-filters__dropdown-item {
      padding: 12px 16px; font-size: 14px; color: var(--arena-text); cursor: pointer;
      transition: background 0.15s;
    }
    .arena-filters__dropdown-item:hover { background: #f1f5f9; }

    .arena-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
    }

    .arena-card {
      background: var(--arena-surface);
      border-radius: 20px;
      border: 1px solid var(--arena-border);
      overflow: hidden;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      transition: transform 0.22s ease, box-shadow 0.22s ease;
      box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06);
    }
    .arena-card:hover {
      transform: translateY(-6px);
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
    }
    .arena-card--skel {
      height: 320px; cursor: default;
      background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%);
      background-size: 200% 100%;
      animation: skel 1.4s infinite;
    }
    @keyframes skel { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

    .arena-card__visual {
      height: 140px; position: relative; display: flex;
      align-items: center; justify-content: center; overflow: hidden;
    }
    .arena-card__img {
      position: absolute; inset: 0; width: 100%; height: 100%;
      object-fit: cover; z-index: 1;
    }
    .arena-card__glyph {
      position: relative; z-index: 0;
      font-size: 56px !important; width: 56px !important; height: 56px !important;
      color: rgba(255,255,255,0.9) !important;
    }
    .arena-card__xp {
      position: absolute; top: 12px; right: 12px;
      padding: 4px 10px; border-radius: 999px;
      font-size: 12px; font-weight: 800; color: #fff;
      background: rgba(0,0,0,0.35); backdrop-filter: blur(4px);
    }
    .arena-card__content { padding: 18px 18px 12px; flex: 1; display: flex; flex-direction: column; gap: 8px; }
    .arena-card__tags { display: flex; flex-wrap: wrap; gap: 6px; }
    .tag {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.04em; padding: 4px 8px; border-radius: 6px;
    }
    .tag--type { background: #e0e7ff; color: #3730a3; }
    .tag--beginner { background: #dcfce7; color: #166534; }
    .tag--intermediate { background: #ffedd5; color: #c2410c; }
    .tag--advanced { background: #fce7f3; color: #9d174d; }
    .tag--level { background: #f3e8ff; color: #6b21a8; }
    .arena-card h3 {
      margin: 0; font-size: 17px; font-weight: 800; color: var(--arena-text);
      line-height: 1.3; letter-spacing: -0.02em;
    }
    .arena-card p {
      margin: 0; font-size: 13px; color: var(--arena-muted); line-height: 1.45;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .arena-card__meta {
      display: flex; gap: 14px; font-size: 12px; color: var(--arena-muted); font-weight: 600;
    }
    .arena-card__meta mat-icon { font-size: 15px; width: 15px; height: 15px; vertical-align: -3px; margin-right: 2px; }
    .arena-card__record {
      display: flex; align-items: center; gap: 6px; font-size: 12px;
      color: #059669; font-weight: 600; padding: 8px 10px;
      background: #ecfdf5; border-radius: 10px; margin-top: 4px;
    }
    .arena-card__record mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .arena-card__play {
      margin: 0 14px 14px; padding: 14px;
      border: none; border-radius: 14px; cursor: pointer;
      font-size: 15px; font-weight: 700; color: #fff;
      display: flex; align-items: center; justify-content: center; gap: 6px;
      background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%);
      box-shadow: 0 6px 20px rgba(37, 99, 235, 0.35);
      transition: filter 0.15s, transform 0.15s;
    }
    .arena-card__play:hover { filter: brightness(1.08); transform: scale(1.01); }
    .arena-card__play mat-icon { font-size: 22px; width: 22px; height: 22px; }

    .arena-empty {
      text-align: center; padding: 56px 24px;
      background: var(--arena-surface); border-radius: 20px; border: 1px dashed var(--arena-border);
    }
    .arena-empty mat-icon { font-size: 48px; width: 48px; height: 48px; color: #cbd5e1; }
    .arena-empty h3 { margin: 12px 0 8px; color: var(--arena-text); }
    .arena-empty p { color: var(--arena-muted); margin-bottom: 16px; }
    .arena-paginator { margin-top: 28px; background: transparent !important; }

    @media (max-width: 640px) {
      .arena { padding: 12px 12px 32px; }
      .arena-hero { border-radius: 18px; }
      .arena-hero h1 { font-size: 22px; }
      .arena-filters__select { width: 100%; flex: 1 1 45%; }
      .arena-grid { grid-template-columns: 1fr; }
      .arena-hero__lb-btn span { display: none; }
      .arena-hero__lb-btn { width: 36px; height: 36px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
      .arena-hero__lb-btn mat-icon { margin: 0 !important; }
    }
  `]
})
export class GameCatalogComponent implements OnInit {
  sets: GameSet[] = [];
  myStats: StudentGameStats | null = null;
  topPlayers: LeaderboardEntry[] = [];
  brokenThumbnails = new Set<string>();
  private readonly thumbnailUrlCache = new Map<string, string>();
  loading = false;
  hasArenaAccess = true;
  accessChecked = false;
  filters: CatalogFilters = { page: 1, limit: 12 };
  pagination = { page: 1, limit: 12, total: 0 };
  searchTimeout: ReturnType<typeof setTimeout> | undefined;
  cefrLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  typeOpen = false;
  levelOpen = false;
  diffOpen = false;

  getTypeLabel(v: string | undefined): string { return v ? this.formatType(v as GameType) : 'Type'; }
  getLevelLabel(v: string | undefined): string { return v || 'Level'; }
  getDiffLabel(v: string | undefined): string { return v || 'Difficulty'; }
  setType(v: string) { this.filters.gameType = v as GameType; this.typeOpen = false; this.load(); }
  setLevel(v: string) { this.filters.level = (v || undefined) as 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | undefined; this.levelOpen = false; this.load(); }
  setDiff(v: string) { this.filters.difficulty = v as 'Beginner' | 'Intermediate' | 'Advanced' | undefined; this.diffOpen = false; this.load(); }

  constructor(
    private svc: InteractiveGameService,
    private mediaService: DigitalExerciseService,
    private router: Router
  ) {}

  ngOnInit() {
    this.svc.getArenaAccess().subscribe({
      next: (r) => {
        this.hasArenaAccess = !!r.hasAccess;
        this.accessChecked = true;
        if (this.hasArenaAccess) {
          this.load();
          this.svc.getMyStats().subscribe({ next: (res) => this.myStats = res.stats });
          this.svc.getGlobalLeaderboard('all').subscribe({ next: (r) => this.topPlayers = (r.leaderboard || []).slice(0, 3) });
        }
      },
      error: () => {
        this.accessChecked = true;
        this.hasArenaAccess = false;
      }
    });
  }

  load() {
    this.loading = true;
    this.brokenThumbnails.clear();
    this.thumbnailUrlCache.clear();
    this.svc.getCatalog(this.filters).subscribe({
      next: (r) => {
        this.sets = r.items || [];
        this.pagination = r.pagination;
        this.resolveThumbnails(this.sets);
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  getThumbnailUrl(set: GameSet): string {
    if (!set?._id) return set?.thumbnailUrl || '';
    return this.thumbnailUrlCache.get(set._id) || set.thumbnailUrl || '';
  }

  private resolveThumbnails(sets: GameSet[]): void {
    const urls = sets.map((s) => String(s.thumbnailUrl || '').trim()).filter(Boolean);
    if (!urls.length) return;
    this.mediaService.resolveMediaFromR2(urls).subscribe({
      next: (res) => {
        const byOriginal = new Map((res.resolutions || []).map((row) => [row.original, row.url]));
        for (const set of sets) {
          const raw = String(set.thumbnailUrl || '').trim();
          if (!raw) continue;
          const resolved = byOriginal.get(raw) || raw;
          this.thumbnailUrlCache.set(set._id, resolved);
        }
      }
    });
  }

  clearFilters() {
    this.filters = { page: 1, limit: 12 };
    this.load();
  }

  onSearch() {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => { this.filters.page = 1; this.load(); }, 400);
  }

  onPage(e: { pageIndex: number }) { this.filters.page = e.pageIndex + 1; this.load(); }

  openGame(set: GameSet) { this.router.navigate(['/glueck-arena', set._id]); }

  playGame(set: GameSet) { this.router.navigate(['/glueck-arena', set._id, 'play']); }

  onThumbnailError(set: GameSet): void {
    if (set?._id) this.brokenThumbnails.add(set._id);
  }

  getTypeColor(type: GameType): string {
    const map: Record<string, string> = {
      scramble_rush: 'linear-gradient(145deg, #1d4ed8 0%, #3b82f6 50%, #60a5fa 100%)',
      sentence_builder: 'linear-gradient(145deg, #15803d 0%, #22c55e 50%, #4ade80 100%)',
      matching: 'linear-gradient(145deg, #6d28d9 0%, #8b5cf6 50%, #a78bfa 100%)',
      flashcards: 'linear-gradient(145deg, #c2410c 0%, #f97316 50%, #fb923c 100%)',
      image_matching: 'linear-gradient(145deg, #6d28d9 0%, #a78bfa 100%)',
      gender_stack: 'linear-gradient(145deg, #0284c7 0%, #38bdf8 50%, #7dd3fc 100%)',
    };
    return map[type] ?? 'linear-gradient(145deg, #1e3a5f, #64748b)';
  }

  formatType(t: GameType): string {
    const map: Record<string, string> = {
      scramble_rush: 'Scramble Rush', sentence_builder: 'Sentence Builder',
      matching: 'Matching', flashcards: 'Flashcards', image_matching: 'Image Matching',
      gender_stack: 'Gender Stack',
    };
    return map[t] ?? t;
  }

  podiumPlayer(index: number): LeaderboardEntry | undefined {
    return this.topPlayers[index];
  }

  podiumInitial(player: LeaderboardEntry | undefined): string {
    const letter = player?.name?.charAt(0);
    return letter ? letter.toUpperCase() : '-';
  }

  podiumXp(player: LeaderboardEntry | undefined): string | number {
    return player?.totalXp ?? '-';
  }

  podiumName(player: LeaderboardEntry | undefined): string {
    return player?.name ?? '-';
  }

  clearPodiumAvatar(player: LeaderboardEntry | undefined): void {
    if (player) player.avatarUrl = undefined;
  }
}
