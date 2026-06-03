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
import { StreakFireComponent } from '../../shared/streak-fire/streak-fire.component';

function xpToLevel(totalXp: number): number {
  return Math.max(1, Math.floor(Math.sqrt((totalXp || 0) / 100)) + 1);
}

function xpForLevel(level: number): number {
  return 100 * Math.pow(level - 1, 2);
}

@Component({
  selector: 'app-game-catalog',
  standalone: true,
  imports: [
    CommonModule, RouterModule, FormsModule, MaterialModule,
    GameStatsBannerComponent, DailyChallengesWidgetComponent, StreakFireComponent
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
          <div class="arena-hero__orbs"></div>
          <div class="arena-hero__top">
            <div class="arena-hero__brand">
              <span class="arena-hero__logo"><mat-icon>sports_esports</mat-icon></span>
              <div>
                <h1>GlückArena</h1>
                <p>Level up dein Deutsch — challenge yourself, earn XP, climb the ranks</p>
              </div>
            </div>
            <div class="arena-hero__right">
              <div class="arena-hero__level" *ngIf="myStats">
                <span class="arena-hero__level-badge">Lv.{{ arenaLevel }}</span>
                <div class="arena-hero__xp-bar-wrap">
                  <div class="arena-hero__xp-bar">
                    <span [style.width.%]="xpProgress"></span>
                  </div>
                  <span class="arena-hero__xp-text">{{ myStats.totalXp }} XP</span>
                </div>
              </div>
              <app-streak-fire *ngIf="myStats" [streak]="myStats.currentStreak"></app-streak-fire>
              <a class="arena-hero__nav-link" routerLink="/glueck-arena/leaderboard">
                <mat-icon>leaderboard</mat-icon>
                <span>Leaderboard</span>
              </a>
            </div>
          </div>
          <app-game-stats-banner *ngIf="myStats" [stats]="myStats" variant="hero"></app-game-stats-banner>

          <div class="arena-hero__events" *ngIf="eventsBanner.length">
            <span class="arena-hero__events-item" *ngFor="let ev of eventsBanner">
              <mat-icon>{{ ev.icon }}</mat-icon>
              {{ ev.text }}
            </span>
          </div>
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
                  <mat-icon class="podium__medal podium__medal--2">military_tech</mat-icon>
                  <span class="podium__xp">{{ podiumXp(podiumPlayer(1)) }}</span>
                </div>
                <span class="podium__name">{{ podiumName(podiumPlayer(1)) }}</span>
              </div>
              <div class="podium__place podium__place--1">
                <div class="podium__avatar">
                  <img *ngIf="podiumPlayer(0)?.avatarUrl" [src]="podiumPlayer(0)!.avatarUrl" (error)="clearPodiumAvatar(podiumPlayer(0))" />
                  <span *ngIf="!podiumPlayer(0)?.avatarUrl">{{ podiumInitial(podiumPlayer(0)) }}</span>
                  <div class="podium__crown" *ngIf="podiumPlayer(0)"><mat-icon>workspace_premium</mat-icon></div>
                </div>
                <div class="podium__bar">
                  <mat-icon class="podium__medal podium__medal--1">emoji_events</mat-icon>
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
                  <mat-icon class="podium__medal podium__medal--3">military_tech</mat-icon>
                  <span class="podium__xp">{{ podiumXp(podiumPlayer(2)) }}</span>
                </div>
                <span class="podium__name">{{ podiumName(podiumPlayer(2)) }}</span>
              </div>
            </div>
            <div class="podium__my-rank" *ngIf="myRank && myRank > 3">
              You're #{{ myRank }} overall —
              <a [routerLink]="['/glueck-arena/leaderboard']">see full board</a>
            </div>
          </div>
        <app-daily-challenges-widget></app-daily-challenges-widget>
        </div>

        <!-- Games section -->
        <section class="arena-games">
          <div class="arena-filters">
            <div class="arena-filters__search">
              <mat-icon>search</mat-icon>
              <input type="search" [(ngModel)]="filters.search" (ngModelChange)="onSearch()"
                placeholder="Search games…" aria-label="Search games">
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
                <div class="arena-filters__dropdown-item" (click)="setType('image_matching')">Image Matching</div>
                <div class="arena-filters__dropdown-item" (click)="setType('gender_stack')">Gender Stack</div>
                <div class="arena-filters__dropdown-item" (click)="setType('flapjugation')">Flapjugation</div>
                <div class="arena-filters__dropdown-item" (click)="setType('whackawort')">Whack-a-Wort</div>
                <div class="arena-filters__dropdown-item" (click)="setType('memory')">Memory Game</div>
                <div class="arena-filters__dropdown-item" (click)="setType('jumbled_words')">Jumbled Words</div>
                <div class="arena-filters__dropdown-item" (click)="setType('hangman')">Hangman</div>
                <div class="arena-filters__dropdown-item" (click)="setType('word_picture_match')">Word-Picture Match</div>
                <div class="arena-filters__dropdown-item" (click)="setType('multiple_choice')">Multiple Choice</div>
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
          </div>

          <div *ngIf="loading" class="arena-grid">
            <div class="arena-card arena-card--skel" *ngFor="let _ of [1,2,3,4,5,6]"></div>
          </div>

          <div *ngIf="!loading && sets.length" class="arena-grid">
            <article class="arena-card" *ngFor="let set of sets; let i = index"
              [style.--card-index]="i"
              (click)="openGame(set)" role="button" tabindex="0" (keyup.enter)="openGame(set)">
              <div class="arena-card__visual" [style.background]="getTypeColor(set.gameType)">
                <img *ngIf="getThumbnailUrl(set) && !brokenThumbnails.has(set._id)" [src]="getThumbnailUrl(set)" alt="" class="arena-card__img" (error)="onThumbnailError(set)">
                <mat-icon *ngIf="!getThumbnailUrl(set) || brokenThumbnails.has(set._id)" class="arena-card__glyph">{{ set.icon || 'sports_esports' }}</mat-icon>
                <span class="arena-card__xp">+{{ set.xpReward }} XP</span>
                <span class="arena-card__new" *ngIf="isNew(set)">NEW</span>
                <span class="arena-card__play-ring" *ngIf="set.studentProgress?.bestScore">
                  <svg viewBox="0 0 36 36" width="24" height="24">
                    <path d="M18 2.0845a15.9155 15.9155 0 0 1 0 31.831a15.9155 15.9155 0 0 1 0-31.831"
                      fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="3"/>
                    <path d="M18 2.0845a15.9155 15.9155 0 0 1 0 31.831a15.9155 15.9155 0 0 1 0-31.831"
                      fill="none" stroke="#fff" stroke-width="3"
                      [attr.stroke-dasharray]="bestScorePct(set) + ', 100'"/>
                  </svg>
                </span>
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
                  <span><mat-icon>quiz</mat-icon> {{ set.questionCount }} Q</span>
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
      margin: 0 auto;
      max-width: 1500px;
      padding: 20px 20px 48px;
      min-height: 60vh;
      background: var(--arena-bg);
      border-radius: 0 0 14px 14px;
      border: 1px solid #e2e8f0;
    }
    .arena__locked { text-align: center; padding: 80px 24px; border-radius: 24px; background: var(--arena-surface); border: 1px dashed var(--arena-border); }
    .arena__locked-icon { width: 72px; height: 72px; margin: 0 auto 20px; border-radius: 50%; background: #f1f5f9; display: flex; align-items: center; justify-content: center; }
    .arena__locked-icon mat-icon { font-size: 36px; width: 36px; height: 36px; color: #94a3b8; }
    .arena__locked h2 { margin: 0 0 10px; color: var(--arena-text); font-size: 22px; }
    .arena__locked p { color: var(--arena-muted); max-width: 400px; margin: 0 auto; line-height: 1.55; }

    /* ─── Hero ─── */
    .arena-hero {
      position: relative; border-radius: 20px; margin-bottom: 20px; overflow: hidden;
      background: linear-gradient(135deg, #0f2744 0%, #1e4d7a 40%, #2563eb 100%);
      padding: 24px 28px;
    }
    .arena-hero__glow {
      position: absolute; top: -50%; left: -20%; width: 140%; height: 200%;
      background: radial-gradient(ellipse at 30% 50%, rgba(59,130,246,0.3) 0%, transparent 60%),
                  radial-gradient(ellipse at 70% 20%, rgba(99,102,241,0.2) 0%, transparent 50%);
      animation: heroGlow 6s ease-in-out infinite alternate;
      pointer-events: none;
    }
    @keyframes heroGlow {
      0% { transform: translate(0, 0) scale(1); opacity: 0.6; }
      50% { transform: translate(3%, -3%) scale(1.05); opacity: 1; }
      100% { transform: translate(-2%, 2%) scale(0.95); opacity: 0.7; }
    }
    .arena-hero__orbs {
      position: absolute; inset: 0; overflow: hidden; pointer-events: none;
    }
    .arena-hero__orbs::before, .arena-hero__orbs::after {
      content: ''; position: absolute; border-radius: 50%;
      opacity: 0.07; animation: orbFloat 8s ease-in-out infinite;
    }
    .arena-hero__orbs::before {
      width: 300px; height: 300px; background: #60a5fa;
      top: -80px; right: -60px; animation-delay: 0s;
    }
    .arena-hero__orbs::after {
      width: 200px; height: 200px; background: #a78bfa;
      bottom: -60px; left: 20%; animation-delay: -3s;
    }
    @keyframes orbFloat {
      0%, 100% { transform: translate(0, 0) scale(1); }
      50% { transform: translate(20px, -20px) scale(1.1); }
    }
    .arena-hero__top {
      display: flex; justify-content: space-between; align-items: flex-start;
      gap: 16px; margin-bottom: 20px; position: relative; z-index: 1;
    }
    .arena-hero__brand { display: flex; gap: 16px; align-items: center; }
    .arena-hero__logo {
      width: 56px; height: 56px; border-radius: 16px; flex-shrink: 0;
      background: rgba(255,255,255,0.12); backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      border: 1px solid rgba(255,255,255,0.15);
    }
    .arena-hero__logo mat-icon { font-size: 32px; width: 32px; height: 32px; color: #fff; }
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
      margin: 0; font-size: 30px; font-weight: 800; color: #fff;
      letter-spacing: -0.03em; line-height: 1.15; text-shadow: 0 2px 12px rgba(0,0,0,0.15);
    }
    .arena-hero p { margin: 6px 0 0; font-size: 14px; color: rgba(255,255,255,0.7); max-width: 380px; }

    .arena-hero__right {
      display: flex; align-items: stretch; gap: 14px; flex-shrink: 0;
    }
    .arena-hero__right > * { display: flex; align-items: center; }
    ::ng-deep .arena-hero__right app-streak-fire .sf { padding: 8px 12px; border: 1px solid rgba(255,255,255,0.12); }
    .arena-hero__level {
      display: flex; align-items: center; gap: 10px;
      background: rgba(255,255,255,0.1); backdrop-filter: blur(8px);
      padding: 8px 14px 8px 10px; border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.12);
    }
    .arena-hero__level-badge {
      font-size: 14px; font-weight: 800; color: #fbbf24;
      background: rgba(251,191,36,0.15); padding: 4px 10px; border-radius: 8px;
      white-space: nowrap;
    }
    .arena-hero__xp-bar-wrap { display: flex; align-items: center; gap: 8px; }
    .arena-hero__xp-bar {
      width: 80px; height: 6px; border-radius: 999px;
      background: rgba(255,255,255,0.15); overflow: hidden;
    }
    .arena-hero__xp-bar span {
      display: block; height: 100%; border-radius: 999px;
      background: linear-gradient(90deg, #fbbf24, #f59e0b);
      transition: width 0.6s ease;
    }
    .arena-hero__xp-text { font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.8); white-space: nowrap; }
    .arena-hero__nav-link {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 14px; border-radius: 12px; text-decoration: none;
      font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.9);
      background: rgba(255,255,255,0.1); backdrop-filter: blur(8px);
      border: 1px solid rgba(255,255,255,0.12);
      transition: background 0.15s;
    }
    .arena-hero__nav-link:hover { background: rgba(255,255,255,0.18); }
    .arena-hero__nav-link mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .arena-hero__events {
      display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; position: relative; z-index: 1;
    }
    .arena-hero__events-item {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 12px; font-weight: 600; color: #fef3c7;
      background: rgba(245,158,11,0.15); padding: 4px 12px; border-radius: 8px;
    }
    .arena-hero__events-item mat-icon { font-size: 14px; width: 14px; height: 14px; color: #fbbf24; }

    ::ng-deep .arena-hero .gsb--hero .gsb__item {
      background: rgba(255,255,255,0.08) !important;
      backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1) !important;
      box-shadow: none !important;
    }
    ::ng-deep .arena-hero .gsb--hero .gsb__val { color: #fff !important; }
    ::ng-deep .arena-hero .gsb--hero .gsb__lbl { color: rgba(255,255,255,0.6) !important; }
    ::ng-deep .arena-hero .gsb--hero .gsb__icon-wrap { background: rgba(255,255,255,0.1) !important; }
    ::ng-deep .arena-hero .gsb--hero { margin-bottom: 0; }
    @media (min-width: 1700px) { ::ng-deep .arena-hero .gsb--hero { grid-template-columns: repeat(7,1fr) !important; } }
    @media (min-width: 1400px) and (max-width: 1699px) { ::ng-deep .arena-hero .gsb--hero { grid-template-columns: repeat(6,1fr) !important; } }
    @media (max-width: 920px) { ::ng-deep .arena-hero .gsb--hero { grid-template-columns: repeat(4,1fr) !important; } }
    @media (max-width: 620px) { ::ng-deep .arena-hero .gsb--hero { grid-template-columns: repeat(3,1fr) !important; } }
    @media (max-width: 500px) { ::ng-deep .arena-hero .gsb--hero { grid-template-columns: repeat(2,1fr) !important; } }

    /* ─── Layout ─── */
    .arena-layout {
      display: grid;
      grid-template-columns: 0.3fr 0.7fr;
      gap: 20px;
      align-items: start;
    }
    @media (max-width: 1000px) { .arena-layout { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 640px) { .arena-layout { grid-template-columns: 1fr; } }
    :host ::ng-deep .arena-layout .dcw__grid { grid-template-columns: 1fr; }

    .arena-left-col { display: flex; flex-direction: column; gap: 16px; }

    /* ─── Podium ─── */
    .podium-card { background: var(--arena-surface); border: 1px solid var(--arena-border); border-radius: 16px; padding: 20px 12px 16px; }
    .podium-heading { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 700; color: #405980; margin-bottom: 16px; padding: 0 4px; }
    .podium-heading mat-icon { font-size: 22px; width: 22px; height: 22px; color: #f59e0b; }
    .podium { display: flex; align-items: flex-end; justify-content: center; gap: 8px; }
    .podium__place { display: flex; flex-direction: column; align-items: center; gap: 6px; position: relative; }
    .podium__crown {
      position: absolute; bottom: -2px; right: -2px; z-index: 2;
      width: 20px; height: 20px; border-radius: 50%;
      background: #1e3a5f; display: flex; align-items: center; justify-content: center;
      animation: crownBounce 2s ease-in-out infinite;
    }
    .podium__crown mat-icon { font-size: 14px; width: 14px; height: 14px; color: #fbbf24; }
    .podium__medal { font-size: 20px !important; width: 20px !important; height: 20px !important; }
    .podium__medal--1 { color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,0.3); }
    .podium__medal--2 { color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,0.3); }
    .podium__medal--3 { color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,0.3); }
    .podium__avatar { width: 44px; height: 44px; border-radius: 50%; background: #e8edf5; color: #405980; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; overflow: visible; flex-shrink: 0; position: relative; }
    .podium__avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
    .podium__crown {
      position: absolute; bottom: -4px; right: -4px; z-index: 2;
      width: 20px; height: 20px; border-radius: 50%;
      background: #1e3a5f; display: flex; align-items: center; justify-content: center;
      animation: crownBounce 2s ease-in-out infinite;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    }
    .podium__crown mat-icon { font-size: 13px; width: 13px; height: 13px; color: #fbbf24; }
    @keyframes crownBounce {
      0%, 100% { transform: translateY(0) rotate(-5deg); }
      50% { transform: translateY(-6px) rotate(5deg); }
    }
    .podium__bar { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; width: 76px; border-radius: 10px 10px 0 0; font-size: 24px; padding: 6px 0; transition: height 0.6s ease; }
    .podium__xp { font-size: 14px; font-weight: 800; color: #fff; }
    .podium__name { font-size: 12px; font-weight: 600; color: var(--arena-muted); max-width: 80px; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .podium__place--1 .podium__bar { height: 110px; background: linear-gradient(180deg,#ffd700,#ffb300); }
    .podium__place--2 .podium__bar { height: 80px; background: linear-gradient(180deg,#b0bec5,#90a4ae); }
    .podium__place--3 .podium__bar { height: 60px; background: linear-gradient(180deg,#cd7f32,#a0522d); }
    .podium__my-rank {
      margin-top: 14px; text-align: center; font-size: 13px; font-weight: 600; color: var(--arena-muted); padding: 10px; background: #f8fafc; border-radius: 10px;
    }
    .podium__my-rank a { color: #2563eb; text-decoration: none; font-weight: 700; }
    .podium__my-rank a:hover { text-decoration: underline; }

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
      display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
      margin-bottom: 20px; padding: 12px 16px;
      background: var(--arena-surface); border-radius: 16px;
      border: 1px solid var(--arena-border);
    }
    .arena-filters__search {
      flex: 1; min-width: 180px; display: flex; align-items: center; gap: 10px;
      padding: 0 14px; height: 34px; border-radius: 10px;
      background: #f1f5f9; border: 1px solid transparent;
    }
    .arena-filters__search mat-icon { color: #94a3b8; font-size: 18px; width: 18px; height: 18px; }
    .arena-filters__search input {
      flex: 1; border: none; background: transparent; outline: none;
      font-size: 12px; font-weight: 700; color: var(--arena-text);
    }
    .arena-filters__search input::placeholder { color: #94a3b8; }
    .arena-filters__dropdown-wrap { position: relative; }
    .arena-filters__dropdown {
      display: flex; align-items: center; gap: 6px;
      height: 34px; padding: 0 12px; border-radius: 10px;
      background: #f1f5f9; border: 1px solid transparent;
      font-size: 12px; font-weight: 700; color: #64748b;
      cursor: pointer; white-space: nowrap; user-select: none;
      transition: border-color 0.15s;
    }
    .arena-filters__dropdown:hover { border-color: #cbd5e1; }
    .arena-filters__dropdown mat-icon { font-size: 18px; width: 18px; height: 18px; color: #94a3b8; }
    .arena-filters__dropdown-menu {
      position: absolute; top: calc(100% + 4px); left: 0; z-index: 100;
      min-width: 180px; padding: 6px; border-radius: 12px;
      background: #fff; border: 1px solid #e2e8f0;
      box-shadow: 0 8px 28px rgba(15,23,42,0.12);
      animation: ddFadeIn 0.15s ease;
    }
    @keyframes ddFadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    .arena-filters__dropdown-item {
      padding: 8px 12px; border-radius: 8px;
      font-size: 12px; font-weight: 600; color: #334155;
      cursor: pointer; transition: background 0.1s;
    }
    .arena-filters__dropdown-item:hover { background: #f1f5f9; }
    .arena-filters__select {
      margin: 0 !important; width: 130px;
    }
    ::ng-deep .arena-filters__select .mat-mdc-text-field-wrapper {
      height: 34px !important; padding: 0 10px !important;
      background: #f1f5f9 !important; border-radius: 10px !important;
      border: 1px solid transparent;
    }
    ::ng-deep .arena-filters__select .mat-mdc-form-field-flex { height: 34px !important; align-items: center !important; }
    ::ng-deep .arena-filters__select .mat-mdc-select { font-size: 12px; font-weight: 700; color: #64748b; }
    ::ng-deep .arena-filters__select .mat-mdc-select-arrow { color: #94a3b8; }
    ::ng-deep .arena-filters__select .mat-mdc-form-field-subscript-wrapper { display: none !important; }
    ::ng-deep .arena-filters__select .mdc-line-ripple { display: none; }
    ::ng-deep .arena-filters__select .mat-mdc-select-value-text .mat-icon {
      font-size: 16px; width: 16px; height: 16px; vertical-align: -3px; margin-right: 2px;
    }


    /* ─── Game Grid ─── */
    .arena-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
    }

    /* ─── Game Card ─── */
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
      animation: cardEntrance 0.5s ease both;
      animation-delay: calc(var(--card-index, 0) * 0.06s);
    }
    @keyframes cardEntrance {
      from { opacity: 0; transform: translateY(24px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
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
    .arena-card__visual::after {
      content: ''; position: absolute; inset: 0; z-index: 2;
      background: linear-gradient(180deg, transparent 60%, rgba(0,0,0,0.15) 100%);
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
      position: absolute; top: 12px; right: 12px; z-index: 3;
      padding: 4px 10px; border-radius: 999px;
      font-size: 12px; font-weight: 800; color: #fff;
      background: rgba(0,0,0,0.35); backdrop-filter: blur(4px);
    }
    .arena-card__new {
      position: absolute; top: 12px; left: 12px; z-index: 3;
      padding: 3px 9px; border-radius: 6px;
      font-size: 10px; font-weight: 800; color: #fff;
      background: linear-gradient(135deg, #ef4444, #dc2626);
      box-shadow: 0 2px 8px rgba(239,68,68,0.4);
      animation: newPulse 2s ease-in-out infinite;
    }
    @keyframes newPulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.08); }
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
    .arena-card__play-ring {
      position: absolute; bottom: 8px; right: 8px; z-index: 3;
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 50%;
      background: rgba(0,0,0,0.35); backdrop-filter: blur(4px);
    }
    .arena-card__play-ring svg { display: block; }
    .arena-card__play {
      margin: 0 14px 14px; padding: 14px;
      border: none; border-radius: 14px; cursor: pointer;
      font-size: 15px; font-weight: 700; color: #fff;
      display: flex; align-items: center; justify-content: center; gap: 6px;
      background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%);
      box-shadow: 0 6px 20px rgba(37, 99, 235, 0.35);
      transition: filter 0.15s, transform 0.15s;
      position: relative; overflow: hidden;
    }
    .arena-card__play::before {
      content: ''; position: absolute; inset: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
      transform: translateX(-100%);
      transition: transform 0.5s;
    }
    .arena-card:hover .arena-card__play::before { transform: translateX(100%); }
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

    /* ─── Responsive ─── */
    @media (max-width: 1200px) {
      .arena-layout { grid-template-columns: 0.35fr 0.65fr; }
    }
    @media (max-width: 1000px) {
      .arena-layout { grid-template-columns: 1fr; }
      .arena-left-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      :host ::ng-deep .arena-left-col .dcw__grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 768px) {
      .arena { padding: 12px 12px 32px; }
      .arena-hero { padding: 16px 14px; border-radius: 14px; }
      .arena-hero__top { flex-direction: column; gap: 12px; }
      .arena-hero__brand { width: 100%; }
      .arena-hero h1 { font-size: 20px; }
      .arena-hero p { font-size: 13px; }
      .arena-hero__right { flex-wrap: wrap; gap: 8px; align-self: flex-start; }
      .arena-hero__level { padding: 4px 8px; gap: 6px; }
      .arena-hero__level-badge { font-size: 12px; padding: 2px 8px; }
      .arena-hero__xp-bar { width: 55px; }
      .arena-hero__xp-text { font-size: 11px; }
      .arena-hero__nav-link { padding: 6px 10px; font-size: 12px; }
      .arena-hero__events { margin-top: 8px; gap: 6px; }
      .arena-hero__events-item { font-size: 11px; padding: 3px 8px; }

      .arena-left-col { grid-template-columns: 1fr; }

      .arena-filters { flex-wrap: wrap; gap: 8px; padding: 10px 12px; }
      .arena-filters__search { min-width: 140px; flex: 1; }
      .arena-filters__select { width: 120px; }

      .arena-grid { grid-template-columns: 1fr 1fr !important; gap: 14px; }
      .arena-card__play-ring { display: none; }
      .arena-card__record { font-size: 11px; padding: 6px 8px; }
    }
    @media (max-width: 480px) {
      .arena { padding: 8px 8px 24px; }
      .arena-hero { padding: 12px 10px; }
      .arena-hero h1 { font-size: 17px; }
      .arena-hero p { display: none; }
      .arena-hero__brand { gap: 10px; }
      .arena-hero__logo { width: 40px; height: 40px; border-radius: 12px; }
      .arena-hero__logo mat-icon { font-size: 24px; width: 24px; height: 24px; }
      .arena-hero__level-badge { font-size: 11px; padding: 2px 6px; }
      .arena-hero__xp-bar { width: 40px; height: 4px; }
      .arena-hero__xp-text { font-size: 10px; }
      .arena-hero__nav-link { padding: 5px 8px; font-size: 11px; }
      .arena-hero__nav-link span { display: none; }
      .arena-hero__events-item { font-size: 10px; padding: 2px 6px; }
      ::ng-deep .arena-hero__right app-streak-fire .sf { padding: 5px 8px; }

      .arena-card { border-radius: 14px; }
      .arena-card__visual { height: 110px; }
      .arena-card h3 { font-size: 15px; }
      .arena-card__meta { font-size: 11px; gap: 10px; }
      .arena-card__play { padding: 12px; font-size: 13px; }
      .arena-grid { grid-template-columns: 1fr !important; }

      .podium-card { padding: 14px 8px 12px; }
      .podium__bar { width: 60px; }
      .podium__place--1 .podium__bar { height: 90px; }
      .podium__place--2 .podium__bar { height: 65px; }
      .podium__place--3 .podium__bar { height: 50px; }

      .arena-paginator { margin-top: 16px; }
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
  myRank: number | null = null;
  eventsBanner: { icon: string; text: string }[] = [];
  typeOpen = false;
  levelOpen = false;
  diffOpen = false;
  cefrLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

  get arenaLevel(): number {
    return this.myStats ? xpToLevel(this.myStats.totalXp) : 1;
  }

  get xpProgress(): number {
    if (!this.myStats) return 0;
    const level = this.arenaLevel;
    const cur = xpForLevel(level);
    const prev = xpForLevel(level - 1);
    return ((this.myStats.totalXp - prev) / (cur - prev)) * 100;
  }

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
          this.svc.getGlobalLeaderboard('all').subscribe({
            next: (r) => {
              this.topPlayers = (r.leaderboard || []).slice(0, 3);
              const me = (r.leaderboard || []).find((e: any) => e.isMe);
              if (me) this.myRank = me.rank;
            }
          });
          this.svc.getDailyChallenges().subscribe({
            next: (r) => {
              const ch = (r.challenges || []) as any[];
              const unclaimed = ch.filter((c: any) => c.isCompleted && !c.isClaimed);
              const active = ch.filter((c: any) => !c.isCompleted);
              this.eventsBanner = [];
              if (unclaimed.length) this.eventsBanner.push({ icon: 'auto_awesome', text: `${unclaimed.length} reward${unclaimed.length > 1 ? 's' : ''} ready to claim!` });
              if (active.length) this.eventsBanner.push({ icon: 'track_changes', text: `${active.length} daily quest${active.length > 1 ? 's' : ''} in progress` });
            }
          });
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

  isNew(set: GameSet): boolean {
    if (!set?.createdAt) return false;
    const age = Date.now() - new Date(set.createdAt).getTime();
    return age < 7 * 24 * 60 * 60 * 1000;
  }

  bestScorePct(set: GameSet): number {
    if (!set.studentProgress?.bestScore) return 0;
    const max = set.questionCount * 100;
    return Math.min(100, (set.studentProgress.bestScore / (max || 1)) * 100);
  }

  getTypeColor(type: GameType): string {
    const map: Record<string, string> = {
      scramble_rush: 'linear-gradient(145deg, #1d4ed8 0%, #3b82f6 50%, #60a5fa 100%)',
      sentence_builder: 'linear-gradient(145deg, #15803d 0%, #22c55e 50%, #4ade80 100%)',
      matching: 'linear-gradient(145deg, #6d28d9 0%, #8b5cf6 50%, #a78bfa 100%)',
      flashcards: 'linear-gradient(145deg, #c2410c 0%, #f97316 50%, #fb923c 100%)',
      image_matching: 'linear-gradient(145deg, #6d28d9 0%, #a78bfa 100%)',
      gender_stack: 'linear-gradient(145deg, #0284c7 0%, #38bdf8 50%, #7dd3fc 100%)',
      flapjugation: 'linear-gradient(145deg, #be185d 0%, #ec4899 50%, #f472b6 100%)',
      whackawort: 'linear-gradient(145deg, #d97706 0%, #f59e0b 50%, #fbbf24 100%)',
      memory: 'linear-gradient(135deg,#0891b2,#22d3ee)',
      jumbled_words: 'linear-gradient(145deg, #7c3aed 0%, #a78bfa 100%)',
      hangman: 'linear-gradient(145deg, #b91c1c 0%, #ef4444 100%)',
      word_picture_match: 'linear-gradient(145deg, #0d9488 0%, #2dd4bf 100%)',
      multiple_choice: 'linear-gradient(145deg, #0891b2 0%, #06b6d4 50%, #22d3ee 100%)',
    };
    return map[type] ?? 'linear-gradient(145deg, #1e3a5f, #64748b)';
  }

  formatType(t: GameType): string {
    const map: Record<string, string> = {
      scramble_rush: 'Scramble Rush', sentence_builder: 'Sentence Builder',
      matching: 'Matching', flashcards: 'Flashcards', image_matching: 'Image Matching',
      gender_stack: 'Gender Stack', flapjugation: 'Flapjugation',
      whackawort: 'Whack-a-Wort',
      memory: 'Memory Game',
      jumbled_words: 'Jumbled Words',
      hangman: 'Hangman',
      word_picture_match: 'Word-Picture Match',
      multiple_choice: 'Multiple Choice',
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
