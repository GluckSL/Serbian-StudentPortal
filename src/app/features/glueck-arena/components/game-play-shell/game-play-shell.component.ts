import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { NotificationService } from '../../../../services/notification.service';
import { AuthService } from '../../../../services/auth.service';
import {
  GameAttempt, GameQuestion, GameLevel, GameSet,
  SentenceQuestion, ScrambleQuestion, AchievementDto, LeaderboardEntry,
} from '../../glueck-arena.types';
import { SentenceBuilderComponent, SBResult } from '../../engines/sentence-builder/sentence-builder.component';
import { ScrambleRushComponent, SRResult } from '../../engines/scramble-rush/scramble-rush.component';

@Component({
  selector: 'app-game-play-shell',
  standalone: true,
  imports: [
    CommonModule, RouterModule, MaterialModule,
    SentenceBuilderComponent, ScrambleRushComponent
  ],
  template: `
    <div class="shell">
      <!-- Loading -->
      <div *ngIf="phase === 'loading'" class="shell__loading">
        <mat-spinner diameter="48"></mat-spinner>
        <p>Loading game…</p>
      </div>

      <!-- Error -->
      <div *ngIf="phase === 'error'" class="shell__error">
        <mat-icon>error</mat-icon>
        <p>{{ error }}</p>
        <button mat-raised-button (click)="back()">Go Back</button>
      </div>

      <!-- Intro -->
      <div *ngIf="phase === 'intro' && set" class="shell-intro">
        <div class="shell-intro__top">
          <div class="shell-intro__main">
            <div class="shell-intro__hero" [style.background]="getTypeColor(set.gameType)">
              <mat-icon>{{ set.icon || 'sports_esports' }}</mat-icon>
            </div>
            <div class="shell-intro__tags">
              <span class="shell-tag">{{ formatType(set.gameType) }}</span>
              <span class="shell-tag">{{ set.difficulty }}</span>
              <span class="shell-tag" *ngIf="set.level">{{ set.level }}</span>
            </div>
            <h1>{{ set.title }}</h1>
            <p class="shell-intro__desc">{{ set.description }}</p>
            <div class="shell-intro__stats">
              <div><mat-icon>quiz</mat-icon><strong>{{ questions.length }}</strong><span>Questions</span></div>
              <div><mat-icon>schedule</mat-icon><strong>~{{ set.estimatedDurationMinutes }}</strong><span>Minutes</span></div>
              <div><mat-icon>timer</mat-icon><strong>Count-up</strong><span>Total time</span></div>
              <div><mat-icon>bolt</mat-icon><strong>{{ set.xpReward }}</strong><span>Max XP</span></div>
            </div>
            <div class="shell-intro__actions">
              <button mat-raised-button color="primary" class="shell-intro__start" (click)="startPlay()">
                <mat-icon>play_arrow</mat-icon> Start game
              </button>
              <button mat-stroked-button (click)="back()">Back to arena</button>
            </div>
          </div>
          <aside class="shell-intro__side">
            <section>
              <h3><mat-icon>rule</mat-icon> How to play</h3>
              <p *ngIf="set.gameType === 'sentence_builder'">Drag words into the correct positions. The clock counts up from zero — finish all sentences as fast as you can.</p>
              <p *ngIf="set.gameType === 'scramble_rush'">Type words before letters fall. Limited lives — complete all levels to win.</p>
            </section>
            <section>
              <h3><mat-icon>leaderboard</mat-icon> Scoring</h3>
              <ul>
                <li *ngIf="set.gameType === 'sentence_builder'"><strong>+15 pts</strong> per correct sentence</li>
                <li *ngIf="set.gameType === 'sentence_builder'">Faster total time = higher leaderboard rank</li>
                <li *ngIf="set.gameType === 'scramble_rush'">Finish levels with lives left for maximum points</li>
                <li *ngIf="set.gameType === 'scramble_rush'">Higher score and speed help you climb the board</li>
              </ul>
            </section>
          </aside>
        </div>

        <section class="shell-compete" aria-labelledby="compete-heading">
          <div class="shell-compete__head">
            <div>
              <h2 id="compete-heading">Compete with your batch</h2>
              <p class="shell-compete__sub">See how you stack up on this game. Finish strong to move up the board.</p>
            </div>
            <a mat-stroked-button color="primary" routerLink="/glueck-arena/leaderboard" class="shell-compete__arena-link">
              <mat-icon>public</mat-icon> Arena leaderboard
            </a>
          </div>

          <div class="shell-compete__grid">
            <article class="shell-batch-card">
              <div class="shell-batch-card__accent"></div>
              <header class="shell-batch-card__header">
                <mat-icon class="shell-batch-card__icon">groups</mat-icon>
                <div>
                  <h3>Your standing</h3>
                  <p class="shell-batch-card__hint">Your profile batch and this run</p>
                </div>
              </header>
              <dl class="shell-batch-card__stats">
                <div class="shell-batch-card__row">
                  <dt><mat-icon>school</mat-icon> Your batch</dt>
                  <dd>{{ studentBatchLabel }}</dd>
                </div>
                <div class="shell-batch-card__row" *ngIf="set.batchLabel">
                  <dt><mat-icon>category</mat-icon> Game cohort</dt>
                  <dd>{{ set.batchLabel }}</dd>
                </div>
                <div class="shell-batch-card__row">
                  <dt><mat-icon>military_tech</mat-icon> Your rank (this game)</dt>
                  <dd>
                    <span class="shell-batch-card__rank-pill" *ngIf="myGameRank != null">#{{ myGameRank }}</span>
                    <span class="shell-batch-card__rank-muted" *ngIf="myGameRank == null && !leaderboardLoading">Not in top 20 yet</span>
                    <span class="shell-batch-card__rank-muted" *ngIf="leaderboardLoading">…</span>
                  </dd>
                </div>
                <div class="shell-batch-card__row" *ngIf="myBoardEntry as me">
                  <dt><mat-icon>emoji_events</mat-icon> Your best listed</dt>
                  <dd><strong>{{ me.bestScore }}</strong> pts · {{ formatLeaderTime(me.bestTime) }}</dd>
                </div>
                <div class="shell-batch-card__row">
                  <dt><mat-icon>replay</mat-icon> This session</dt>
                  <dd>Attempt #{{ attempt?.attemptNumber ?? '—' }}</dd>
                </div>
              </dl>
              <p class="shell-batch-card__foot" *ngIf="gameLeaderboard.length">
                <mat-icon>info_outline</mat-icon>
                {{ gameLeaderboard.length }} players on this board — tie-breakers use best time.
              </p>
            </article>

            <article class="shell-lb-card">
              <header class="shell-lb-card__head">
                <div class="shell-lb-card__title">
                  <mat-icon>format_list_numbered</mat-icon>
                  <div>
                    <h3>Top players</h3>
                    <span>Live rankings for {{ set.title }}</span>
                  </div>
                </div>
                <div class="shell-lb-card__shine" aria-hidden="true"></div>
              </header>

              <div class="shell-lb-skel" *ngIf="leaderboardLoading">
                <div class="shell-lb-skel__row" *ngFor="let _ of [1,2,3,4,5]"></div>
              </div>

              <div class="shell-lb-empty" *ngIf="!leaderboardLoading && !gameLeaderboard.length">
                <mat-icon>rocket_launch</mat-icon>
                <p><strong>No scores yet.</strong> Be the first from your batch to finish and own rank #1.</p>
              </div>

              <div class="shell-lb-table-wrap" *ngIf="!leaderboardLoading && gameLeaderboard.length">
                <table class="shell-lb-table">
                  <thead>
                    <tr>
                      <th scope="col">Rank</th>
                      <th scope="col">Player</th>
                      <th scope="col">Score</th>
                      <th scope="col">Best time</th>
                      <th scope="col">Runs</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let e of gameLeaderboard"
                        [class.shell-lb-table__me]="isLeaderboardMe(e)"
                        [class.shell-lb-table__row--1]="e.rank === 1"
                        [class.shell-lb-table__row--2]="e.rank === 2"
                        [class.shell-lb-table__row--3]="e.rank === 3">
                      <td>
                        <span class="shell-lb-rank" [attr.data-rank]="e.rank">{{ e.rank }}</span>
                      </td>
                      <td>
                        <div class="shell-lb-player">
                          <div class="shell-lb-avatar" *ngIf="e.avatarUrl as av">
                            <img [src]="av" alt="">
                          </div>
                          <div class="shell-lb-avatar shell-lb-avatar--txt" *ngIf="!e.avatarUrl">{{ playerInitials(e.name) }}</div>
                          <div class="shell-lb-player__meta">
                            <span class="shell-lb-name">{{ e.name }}</span>
                            <span class="shell-lb-you" *ngIf="isLeaderboardMe(e)">You</span>
                          </div>
                        </div>
                      </td>
                      <td><span class="shell-lb-score">{{ e.bestScore }}</span></td>
                      <td class="shell-lb-muted">{{ formatLeaderTime(e.bestTime) }}</td>
                      <td class="shell-lb-muted">{{ e.attempts ?? '—' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </section>
      </div>

      <!-- Engines -->
      <app-sentence-builder
        *ngIf="phase === 'playing' && set?.gameType === 'sentence_builder' && attempt && set"
        [attempt]="attempt!"
        [gameSet]="set"
        [questions]="asSentenceQuestions()"
        (onComplete)="handleComplete($event)"
      ></app-sentence-builder>

      <app-scramble-rush
        *ngIf="phase === 'playing' && set?.gameType === 'scramble_rush' && attempt"
        [attempt]="attempt!"
        [questions]="asScrambleQuestions()"
        [levels]="levels"
        (onComplete)="handleScrambleComplete($event)"
      ></app-scramble-rush>

      <!-- Placeholder -->
      <div *ngIf="phase === 'playing' && isPlaceholderType()" class="shell__placeholder">
        <mat-icon>construction</mat-icon>
        <h3>Coming Soon</h3>
        <p>{{ set?.gameType }} game type is coming soon!</p>
        <button mat-raised-button (click)="back()">Back to GlückArena</button>
      </div>

      <div class="shell__badge-popup" *ngIf="newBadges.length">
        <mat-icon>emoji_events</mat-icon>
        <div>
          <strong>Badge unlocked!</strong>
          <p *ngFor="let b of newBadges">{{ b.title }}</p>
        </div>
        <button mat-icon-button (click)="newBadges = []"><mat-icon>close</mat-icon></button>
      </div>

      <!-- Results -->
      <div *ngIf="phase === 'results'" class="shell__results">
        <mat-icon class="shell__results__icon">emoji_events</mat-icon>
        <h2>Game Complete!</h2>
        <div class="shell__results__stats">
          <div class="shell__results__stat">
            <span class="shell__results__val">{{ finalScore }}</span>
            <span class="shell__results__lbl">Score</span>
          </div>
          <div class="shell__results__stat">
            <span class="shell__results__val">{{ finalXp }}</span>
            <span class="shell__results__lbl">XP Earned</span>
          </div>
          <div class="shell__results__stat">
            <span class="shell__results__val">{{ finalAccuracy }}%</span>
            <span class="shell__results__lbl">Accuracy</span>
          </div>
          <div class="shell__results__stat" *ngIf="finalTimeSeconds > 0">
            <span class="shell__results__val">{{ formatTime(finalTimeSeconds) }}</span>
            <span class="shell__results__lbl">Time</span>
          </div>
        </div>
        <button mat-raised-button color="primary" routerLink="/glueck-arena/leaderboard">
          <mat-icon>leaderboard</mat-icon> Leaderboard
        </button>
        <button mat-stroked-button routerLink="/glueck-arena">Back to Games</button>
      </div>
    </div>
  `,
  styles: [`
    .shell { max-width: 1180px; margin: 0 auto; padding: 16px; }
    .shell__loading, .shell__error { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 64px; text-align: center; }
    .shell__error mat-icon { font-size: 48px; width: 48px; height: 48px; color: #c62828; }

    .shell-intro { display: flex; flex-direction: column; gap: 28px; }
    .shell-intro__top {
      display: grid; grid-template-columns: 1fr 320px; gap: 24px; align-items: start;
    }
    @media (max-width: 860px) { .shell-intro__top { grid-template-columns: 1fr; } }
    .shell-intro__main {
      background: #fff; border-radius: 24px; padding: 32px 28px;
      box-shadow: 0 12px 40px rgba(15, 23, 42, 0.1); border: 1px solid #e2e8f0;
    }
    .shell-intro__hero {
      width: 88px; height: 88px; border-radius: 20px;
      display: flex; align-items: center; justify-content: center; margin-bottom: 16px;
    }
    .shell-intro__hero mat-icon { font-size: 44px; width: 44px; height: 44px; color: rgba(255,255,255,.95); }
    .shell-intro__tags { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .shell-tag {
      font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px;
      background: #e0e7ff; color: #3730a3; text-transform: uppercase; letter-spacing: 0.04em;
    }
    .shell-intro__main h1 { margin: 0 0 10px; font-size: 28px; font-weight: 800; color: #0f172a; letter-spacing: -0.02em; }
    .shell-intro__desc { color: #64748b; line-height: 1.6; margin: 0 0 24px; font-size: 15px; }
    .shell-intro__stats {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px;
    }
    @media (max-width: 600px) { .shell-intro__stats { grid-template-columns: repeat(2, 1fr); } }
    .shell-intro__stats > div {
      text-align: center; padding: 14px 8px; border-radius: 14px;
      background: #f8fafc; border: 1px solid #e2e8f0;
    }
    .shell-intro__stats mat-icon { color: #6366f1; font-size: 22px; width: 22px; height: 22px; }
    .shell-intro__stats strong { display: block; font-size: 20px; color: #1e293b; margin-top: 4px; }
    .shell-intro__stats span { font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 600; }
    .shell-intro__actions { display: flex; gap: 12px; flex-wrap: wrap; }
    .shell-intro__start { padding: 12px 28px !important; border-radius: 14px !important; font-size: 16px !important; }
    .shell-intro__side {
      background: #fff; border-radius: 20px; padding: 24px;
      border: 1px solid #e2e8f0; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
      position: sticky; top: 16px;
    }
    .shell-intro__side section { margin-bottom: 20px; }
    .shell-intro__side section:last-child { margin-bottom: 0; }
    .shell-intro__side h3 {
      display: flex; align-items: center; gap: 8px; margin: 0 0 10px;
      font-size: 13px; font-weight: 800; text-transform: uppercase; color: #475569;
    }
    .shell-intro__side h3 mat-icon { color: #6366f1; font-size: 20px; width: 20px; height: 20px; }
    .shell-intro__side p, .shell-intro__side li { font-size: 13px; color: #64748b; line-height: 1.55; }
    .shell-intro__side ul { margin: 0; padding-left: 18px; }

    .shell-compete__head {
      display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px;
    }
    .shell-compete__head h2 {
      margin: 0 0 4px; font-size: 22px; font-weight: 800; color: #0f172a; letter-spacing: -0.02em;
    }
    .shell-compete__sub { margin: 0; font-size: 14px; color: #64748b; max-width: 520px; line-height: 1.5; }
    .shell-compete__arena-link {
      border-radius: 12px !important; font-weight: 600;
    }
    .shell-compete__arena-link mat-icon {
      margin-right: 6px; vertical-align: middle; font-size: 20px; width: 20px; height: 20px;
    }

    .shell-compete__grid {
      display: grid; grid-template-columns: minmax(260px, 340px) 1fr; gap: 24px; align-items: stretch;
    }
    @media (max-width: 960px) { .shell-compete__grid { grid-template-columns: 1fr; } }

    .shell-batch-card {
      position: relative; background: #fff; border-radius: 24px; padding: 24px 22px 20px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 16px 48px rgba(15, 23, 42, 0.08);
      overflow: hidden;
    }
    .shell-batch-card__accent {
      position: absolute; top: 0; left: 0; right: 0; height: 4px;
      background: linear-gradient(90deg, #6366f1, #8b5cf6, #ec4899);
    }
    .shell-batch-card__header {
      display: flex; gap: 14px; align-items: flex-start; margin-bottom: 18px;
    }
    .shell-batch-card__icon {
      font-size: 36px; width: 36px; height: 36px;
      color: #6366f1; background: #eef2ff; border-radius: 12px; padding: 8px;
      box-sizing: content-box !important; width: 36px !important; height: 36px !important;
    }
    .shell-batch-card__header h3 { margin: 0 0 4px; font-size: 17px; font-weight: 800; color: #1e293b; }
    .shell-batch-card__hint { margin: 0; font-size: 12px; color: #94a3b8; }
    .shell-batch-card__stats { margin: 0; display: flex; flex-direction: column; gap: 0; }
    .shell-batch-card__row {
      display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center;
      padding: 12px 0; border-bottom: 1px solid #f1f5f9;
    }
    .shell-batch-card__row:last-of-type { border-bottom: none; }
    .shell-batch-card__row dt {
      display: flex; align-items: center; gap: 8px; margin: 0; font-size: 12px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.04em; color: #64748b;
    }
    .shell-batch-card__row dt mat-icon { font-size: 18px; width: 18px; height: 18px; color: #94a3b8; }
    .shell-batch-card__row dd { margin: 0; font-size: 15px; font-weight: 600; color: #0f172a; text-align: right; }
    .shell-batch-card__rank-pill {
      display: inline-block; padding: 4px 12px; border-radius: 999px;
      background: linear-gradient(135deg, #fef3c7, #fde68a); color: #92400e; font-weight: 800;
    }
    .shell-batch-card__rank-muted { font-size: 14px; font-weight: 500; color: #94a3b8; }
    .shell-batch-card__foot {
      display: flex; align-items: flex-start; gap: 8px; margin: 16px 0 0; padding: 12px;
      background: #f8fafc; border-radius: 12px; font-size: 12px; color: #64748b; line-height: 1.45;
    }
    .shell-batch-card__foot mat-icon {
      font-size: 18px; width: 18px; height: 18px; color: #6366f1; flex-shrink: 0; margin-top: 1px;
    }

    .shell-lb-card {
      position: relative; background: #fff; border-radius: 24px; border: 1px solid #e2e8f0;
      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.1); overflow: hidden;
    }
    .shell-lb-card__head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 20px 22px;
      background: linear-gradient(135deg, #1e293b 0%, #334155 45%, #0f172a 100%);
      color: #fff; position: relative; overflow: hidden;
    }
    .shell-lb-card__title {
      display: flex; align-items: center; gap: 14px; position: relative; z-index: 1;
    }
    .shell-lb-card__title mat-icon {
      font-size: 32px; width: 32px; height: 32px; color: #fde047; opacity: 0.95;
    }
    .shell-lb-card__title h3 { margin: 0 0 2px; font-size: 18px; font-weight: 800; letter-spacing: -0.02em; }
    .shell-lb-card__title span { font-size: 12px; color: rgba(255,255,255,0.7); font-weight: 500; }
    .shell-lb-card__shine {
      position: absolute; right: -40px; top: -40px; width: 180px; height: 180px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(99,102,241,0.5) 0%, transparent 70%);
      pointer-events: none;
    }

    .shell-lb-skel { padding: 16px 20px 20px; display: flex; flex-direction: column; gap: 10px; }
    .shell-lb-skel__row {
      height: 48px; border-radius: 12px;
      background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
      background-size: 200% 100%; animation: skel 1.2s ease-in-out infinite;
    }
    @keyframes skel { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }

    .shell-lb-empty {
      padding: 48px 24px; text-align: center; color: #64748b;
    }
    .shell-lb-empty mat-icon { font-size: 48px; width: 48px; height: 48px; color: #c7d2fe; margin-bottom: 12px; }
    .shell-lb-empty p { margin: 0; font-size: 15px; line-height: 1.55; max-width: 360px; margin-inline: auto; }

    .shell-lb-table-wrap { padding: 0 0 8px; overflow-x: auto; }
    .shell-lb-table {
      width: 100%; border-collapse: separate; border-spacing: 0;
    }
    .shell-lb-table thead th {
      text-align: left; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em;
      color: #94a3b8; padding: 14px 20px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
    }
    .shell-lb-table tbody td {
      padding: 14px 20px; vertical-align: middle; border-bottom: 1px solid #f1f5f9; font-size: 14px;
    }
    .shell-lb-table tbody tr:last-child td { border-bottom: none; }
    .shell-lb-table tbody tr { transition: background 0.15s ease; }
    .shell-lb-table tbody tr:hover { background: #fafafa; }

    .shell-lb-table__row--1 td:first-child { background: linear-gradient(180deg, rgba(253,224,71,0.25), transparent); }
    .shell-lb-table__row--2 td:first-child { background: linear-gradient(180deg, rgba(226,232,240,0.9), transparent); }
    .shell-lb-table__row--3 td:first-child { background: linear-gradient(180deg, rgba(253,186,116,0.35), transparent); }
    .shell-lb-table__me {
      background: linear-gradient(90deg, rgba(99,102,241,0.12), rgba(99,102,241,0.02)) !important;
      box-shadow: inset 3px 0 0 #6366f1;
    }

    .shell-lb-rank {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 36px; height: 36px; padding: 0 8px; border-radius: 12px;
      font-weight: 800; font-size: 14px; color: #475569; background: #f1f5f9;
    }
    .shell-lb-table__row--1 .shell-lb-rank {
      background: linear-gradient(135deg, #fde047, #facc15); color: #713f12; box-shadow: 0 4px 12px rgba(250,204,21,0.4);
    }
    .shell-lb-table__row--2 .shell-lb-rank {
      background: linear-gradient(135deg, #e2e8f0, #cbd5e1); color: #334155;
    }
    .shell-lb-table__row--3 .shell-lb-rank {
      background: linear-gradient(135deg, #fdba74, #fb923c); color: #7c2d12;
    }

    .shell-lb-player { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .shell-lb-avatar {
      width: 40px; height: 40px; border-radius: 12px; overflow: hidden; flex-shrink: 0;
      border: 2px solid #e2e8f0;
    }
    .shell-lb-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .shell-lb-avatar--txt {
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 800; color: #6366f1; background: #eef2ff; border-color: #c7d2fe;
    }
    .shell-lb-player__meta { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .shell-lb-name { font-weight: 700; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .shell-lb-you {
      font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em;
      color: #6366f1;
    }
    .shell-lb-score { font-weight: 800; font-size: 15px; color: #ea580c; }
    .shell-lb-muted { color: #64748b; font-variant-numeric: tabular-nums; }

    .shell__placeholder { text-align: center; padding: 64px 16px; background: #fff; border-radius: 20px; }
    .shell__placeholder mat-icon { font-size: 64px; width: 64px; height: 64px; color: #888; }

    .shell__results { text-align: center; padding: 48px 24px; background: #fff; border-radius: 20px; box-shadow: 0 4px 20px rgba(0,0,0,.1); display: flex; flex-direction: column; align-items: center; gap: 20px; }
    .shell__results__icon { font-size: 72px; width: 72px; height: 72px; color: #ff8f00; }
    .shell__results h2 { font-size: 26px; font-weight: 700; margin: 0; }
    .shell__results__stats { display: flex; gap: 32px; }
    .shell__results__stat { display: flex; flex-direction: column; align-items: center; }
    .shell__results__val { font-size: 32px; font-weight: 800; color: #405980; }
    .shell__results__lbl { font-size: 13px; color: #888; }
    .shell__badge-popup {
      position: fixed; bottom: 24px; right: 24px; z-index: 100;
      display: flex; align-items: flex-start; gap: 12px;
      background: linear-gradient(135deg,#ff8f00,#ffc107); color: #fff;
      padding: 16px 20px; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,.2);
      max-width: 320px; animation: badgePop .4s ease;
    }
    .shell__badge-popup mat-icon { font-size: 36px; width: 36px; height: 36px; }
    @keyframes badgePop { from { transform: scale(.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  `]
})
export class GamePlayShellComponent implements OnInit {
  phase: 'loading' | 'intro' | 'playing' | 'results' | 'error' = 'loading';
  error = '';
  set: GameSet | null = null;
  attempt: GameAttempt | null = null;
  questions: GameQuestion[] = [];
  levels: GameLevel[] = [];
  finalScore = 0;
  finalXp = 0;
  finalAccuracy = 0;
  finalTimeSeconds = 0;
  newBadges: AchievementDto[] = [];
  gameLeaderboard: LeaderboardEntry[] = [];
  leaderboardLoading = false;
  myGameRank: number | null = null;

  constructor(
    private svc: InteractiveGameService,
    private notify: NotificationService,
    private route: ActivatedRoute,
    private router: Router,
    private auth: AuthService
  ) {}

  get studentBatchLabel(): string {
    const b = this.auth.getSnapshotUser()?.batch;
    return b ? String(b) : 'Not set on profile';
  }

  get myBoardEntry(): LeaderboardEntry | null {
    const row = this.gameLeaderboard.find((e) => this.isLeaderboardMe(e));
    return row ?? null;
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.svc.startAttempt(id).subscribe({
      next: (r) => {
        this.set = r.set;
        this.attempt = r.attempt;
        this.questions = r.questions;
        this.levels = r.levels || [];
        this.phase = 'intro';
        this.fetchGameLeaderboard(id);
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not start game';
        this.phase = 'error';
      }
    });
  }

  private fetchGameLeaderboard(gameSetId: string) {
    this.leaderboardLoading = true;
    this.svc.getGameLeaderboard(gameSetId).subscribe({
      next: (data) => {
        this.gameLeaderboard = data.leaderboard ?? [];
        this.myGameRank = data.studentRank ?? null;
        this.leaderboardLoading = false;
      },
      error: () => {
        this.leaderboardLoading = false;
      },
    });
  }

  isLeaderboardMe(e: LeaderboardEntry): boolean {
    const me = this.auth.getSnapshotUser()?._id;
    return !!me && String(e.studentId) === String(me);
  }

  playerInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  formatLeaderTime(sec: number | undefined): string {
    if (sec == null || Number.isNaN(sec)) return '—';
    return this.formatTime(sec);
  }

  startPlay() { this.phase = 'playing'; }

  back() { this.router.navigate(['/glueck-arena']); }

  asSentenceQuestions(): SentenceQuestion[] { return this.questions as SentenceQuestion[]; }
  asScrambleQuestions(): ScrambleQuestion[] { return this.questions as ScrambleQuestion[]; }

  isPlaceholderType(): boolean {
    return ['matching', 'flashcards'].includes(this.set?.gameType ?? '');
  }

  handleComplete(result: SBResult) {
    this.finalScore = result.score;
    this.finalAccuracy = result.accuracy;
    this.finalTimeSeconds = result.timeSpentSeconds;
    if (!this.attempt) return;

    this.svc.completeAttempt(this.attempt._id, {
      timeSpentSeconds: result.timeSpentSeconds,
    }).subscribe({
      next: (r) => {
        this.finalXp = r.xpBonus ?? 0;
        this.newBadges = r.newAchievements || [];
        this.phase = 'results';
        this.notify.success(`🎉 +${r.xpBonus} XP earned!`);
      },
      error: () => { this.phase = 'results'; }
    });
  }

  handleScrambleComplete(result: SRResult) {
    this.finalScore = result.score;
    this.finalAccuracy = result.accuracy;
    if (!this.attempt) return;

    this.svc.completeAttempt(this.attempt._id, {
      timeSpentSeconds: result.timeSpentSeconds,
      livesRemaining: result.livesRemaining,
      currentLevel: result.currentLevel,
    }).subscribe({
      next: (r) => {
        this.finalXp = r.xpBonus ?? 0;
        this.newBadges = r.newAchievements || [];
        this.phase = 'results';
        this.notify.success(`🎉 +${r.xpBonus} XP earned!`);
      },
      error: () => { this.phase = 'results'; }
    });
  }

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
  }

  formatType(t: string): string {
    const map: Record<string, string> = {
      scramble_rush: 'Scramble Rush', sentence_builder: 'Sentence Builder',
      matching: 'Matching', flashcards: 'Flashcards',
    };
    return map[t] ?? t;
  }

  getTypeColor(type: string): string {
    const map: Record<string, string> = {
      scramble_rush: 'linear-gradient(135deg,#1565c0,#42a5f5)',
      sentence_builder: 'linear-gradient(135deg,#2e7d32,#66bb6a)',
    };
    return map[type] ?? 'linear-gradient(135deg,#405980,#7a9cc0)';
  }
}
