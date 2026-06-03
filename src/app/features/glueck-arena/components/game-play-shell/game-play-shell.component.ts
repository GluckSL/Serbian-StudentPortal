import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { DigitalExerciseService } from '../../../../services/digital-exercise.service';
import { NotificationService } from '../../../../services/notification.service';
import { AuthService } from '../../../../services/auth.service';
import {
  GameAttempt, GameQuestion, GameLevel, GameSet,
  SentenceQuestion, ScrambleQuestion, ImageMatchingQuestion, GenderStackQuestion, FlapjugationQuestion, WhackawortQuestion, MemoryGameQuestion, JumbledWordsQuestion, HangmanQuestion, WordPictureMatchQuestion, MatchingQuestion, MultipleChoiceQuestion, AchievementDto, LeaderboardEntry,
} from '../../glueck-arena.types';
import { MultipleChoiceComponent, MCResult } from '../../engines/multiple-choice/multiple-choice.component';
import { SentenceBuilderComponent, SBResult } from '../../engines/sentence-builder/sentence-builder.component';
import { ScrambleRushComponent, SRResult } from '../../engines/scramble-rush/scramble-rush.component';
import { ImageMatchingComponent } from '../../engines/image-matching/image-matching.component';
import { MatchingComponent, MatchResult } from '../../engines/matching/matching.component';
import { GenderStackComponent, GSResult } from '../../engines/gender-stack/gender-stack.component';
import { FlapjugationComponent, FJResult } from '../../engines/flapjugation/flapjugation.component';
import { WhackawortComponent, WWResult } from '../../engines/whackawort/whackawort.component';
import { JumbledWordsComponent, JWResult } from '../../engines/jumbled-words/jumbled-words.component';
import { MemoryGameComponent, MemoryResult } from '../../engines/memory-game/memory-game.component';
import { HangmanGameComponent, HangmanResult } from '../../engines/hangman-game/hangman-game.component';
import { WordPictureMatchComponent, WPMResult } from '../../engines/word-picture-match/word-picture-match.component';

export interface IMResult {
  score: number;
  xpEarned: number;
  accuracy: number;
  timeSpentSeconds: number;
}

@Component({
  selector: 'app-game-play-shell',
  standalone: true,
  imports: [
    CommonModule, RouterModule, MaterialModule,
    SentenceBuilderComponent, ScrambleRushComponent, ImageMatchingComponent, GenderStackComponent, FlapjugationComponent, WhackawortComponent, JumbledWordsComponent, MemoryGameComponent, MatchingComponent, HangmanGameComponent, WordPictureMatchComponent, MultipleChoiceComponent
  ],
  template: `
    <div class="shell">
      <!-- Loading -->
      <div *ngIf="phase === 'loading'" class="shell__loading">
        <div class="shell__loading-grid">
          <div class="shell__loading-side">
            <div class="shell__loading-block" style="height:120px"></div>
            <div class="shell__loading-block" style="height:100px"></div>
          </div>
          <div class="shell__loading-main">
            <div class="shell__loading-block" style="height:180px"></div>
            <div class="shell__loading-block" style="height:200px"></div>
            <div class="shell__loading-block" style="height:80px"></div>
          </div>
          <div class="shell__loading-right">
            <div class="shell__loading-block" style="height:200px"></div>
          </div>
        </div>
      </div>

      <!-- Error -->
      <div *ngIf="phase === 'error'" class="shell__error">
        <mat-icon>error</mat-icon>
        <p>{{ error }}</p>
        <button mat-raised-button (click)="back()">Go Back</button>
      </div>

      <div class="shell-preview-banner" *ngIf="isAdminPreview">
        <mat-icon>visibility</mat-icon>
        <span>Admin preview — scores and XP are not saved to student leaderboards.</span>
      </div>

      <!-- Unified shell layout for intro and playing phases -->
      <div class="shell-game-wrap" *ngIf="phase === 'intro' || phase === 'playing' || phase === 'results'">

        <div class="shell-game-wrap__left">

          <!-- Info card -->
          <aside class="shell-side__info" *ngIf="set">
            <button class="shell-side__back" (click)="back()"><mat-icon>arrow_back</mat-icon></button>
            <div class="sb-panel__game">
              <div class="sb-panel__thumb" [style.background]="getTypeColor(set.gameType)">
                <img *ngIf="getThumbnailUrl(set) && !thumbnailBroken" [src]="getThumbnailUrl(set)" alt="" class="sb-panel__thumb-img" (error)="onThumbnailError()">
                <mat-icon *ngIf="!getThumbnailUrl(set) || thumbnailBroken">{{ set.icon || 'sports_esports' }}</mat-icon>
              </div>
              <h2>{{ set.title }}</h2>
              <p class="sb-panel__type">{{ formatType(set.gameType) }}</p>
              <p class="sb-panel__category" *ngIf="set.category">{{ set.category }}</p>
            </div>
            <section class="sb-panel__block sb-panel__block--meta">
              <div class="sb-panel__meta-row" *ngIf="set.level"><mat-icon>school</mat-icon><span>{{ set.level }}</span></div>
              <div class="sb-panel__meta-row"><mat-icon>bolt</mat-icon><span>+{{ set.xpReward }} XP</span></div>
              <div class="sb-panel__meta-row"><mat-icon>schedule</mat-icon><span>~{{ set.estimatedDurationMinutes }} min</span></div>
              <div class="sb-panel__meta-row"><mat-icon>quiz</mat-icon><span>{{ questions.length }} questions</span></div>
              <div class="sb-panel__meta-row" *ngIf="set.courseDay"><mat-icon>flag</mat-icon><span>Journey day {{ set.courseDay }}</span></div>
            </section>
            <section class="sb-panel__block">
              <h3><mat-icon>info</mat-icon> How it works</h3>
              <p *ngIf="set.gameType === 'sentence_builder'">Drag words into the correct positions. The clock counts up from zero — finish all sentences as fast as you can.</p>
              <p *ngIf="set.gameType === 'scramble_rush'">Type words before letters fall. Limited lives — complete all levels to win.</p>
              <p *ngIf="set.gameType === 'image_matching'">Drag each word to the matching image. Match all pairs to complete the game.</p>
              <p *ngIf="set.gameType === 'gender_stack'">Words fall from the sky and stack on the shelf — drag each noun into DER, DIE, or DAS before the pile overflows. You have 5 lives.</p>
              <p *ngIf="set.gameType === 'matching'">Match each item on the left with the correct item on the right, then check your answers.</p>
              <p *ngIf="set.gameType === 'flashcards'">Complete all items in this module to earn XP.</p>
              <p *ngIf="set.gameType === 'flapjugation'">Fly your bird into the correct verb conjugation — dodge all the wrong ones. Each pronoun cycles after 3 correct hits.</p>
              <p *ngIf="set.gameType === 'whackawort'">Whack the German words that match the target category — hit the wrong ones and lose a life!</p>
              <p *ngIf="set.gameType === 'memory'">Flip cards to reveal pictures and words. Find and match each picture with the correct word. Match all pairs to win!</p>
              <p *ngIf="set.gameType === 'jumbled_words'">Look at the picture and arrange the jumbled letters into the correct order to form the word. Drag each letter tile into the right slot and submit your answer.</p>
              <p *ngIf="set.gameType === 'hangman'">Read the clue and guess the word one letter at a time. Each wrong guess brings the hangman closer — guess all letters before the figure is complete to win!</p>
              <p *ngIf="set.gameType === 'word_picture_match'">Match each word to the correct picture. Click the picture that matches the word shown — match all pairs before time runs out!</p>
              <p *ngIf="set.gameType === 'multiple_choice'">Read the question and choose the correct answer from the options. Each correct answer earns points — answer as many as you can before time runs out!</p>
            </section>
          </aside>

        </div>

        <!-- Main game content -->
        <div class="shell-game-wrap__main">

          <!-- Intro -->
          <div *ngIf="phase === 'intro' && set" class="shell-intro">
            <div class="shell-intro__main">
              <div class="shell-intro__banner" [style.background]="getTypeColor(set.gameType)">
                <img *ngIf="getThumbnailUrl(set) && !thumbnailBroken" [src]="getThumbnailUrl(set)" alt="" class="shell-intro__banner-img" (error)="onThumbnailError()">
                <div class="shell-intro__banner-fallback" *ngIf="!getThumbnailUrl(set) || thumbnailBroken">
                  <mat-icon>{{ set.icon || 'sports_esports' }}</mat-icon>
                </div>
                <span class="shell-intro__banner-xp">+{{ set.xpReward }} XP</span>
              </div>
              <div class="shell-intro__body">
              <div class="shell-intro__tags">
                <span class="shell-tag">{{ formatType(set.gameType) }}</span>
                <span class="shell-tag">{{ set.difficulty }}</span>
                <span class="shell-tag" *ngIf="set.level">{{ set.level }}</span>
                <span class="shell-tag shell-tag--muted" *ngIf="set.category">{{ set.category }}</span>
                <span class="shell-tag shell-tag--muted" *ngIf="set.courseDay">Day {{ set.courseDay }}</span>
              </div>
              <h1>{{ set.title }}</h1>
              <p class="shell-intro__desc">{{ set.description || 'Get ready to practice your German skills.' }}</p>
              <div class="shell-intro__stats">
                <div class="shell-intro__stat"><mat-icon>quiz</mat-icon><strong>{{ questions.length }}</strong><span>Questions</span></div>
                <div class="shell-intro__stat"><mat-icon>schedule</mat-icon><strong>~{{ set.estimatedDurationMinutes }}</strong><span>Minutes</span></div>
                <div class="shell-intro__stat"><mat-icon>timer</mat-icon><strong>Count-up</strong><span>Total time</span></div>
                <div class="shell-intro__stat"><mat-icon>bolt</mat-icon><strong>{{ set.xpReward }}</strong><span>Max XP</span></div>
              </div>
              <div class="shell-intro__actions">
                <button class="shell-intro__start" (click)="startPlay()">
                  <mat-icon>play_arrow</mat-icon>
                  <span>Start game</span>
                </button>
              </div>
              </div>
            </div>
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

          <app-image-matching
            *ngIf="phase === 'playing' && set?.gameType === 'image_matching' && attempt"
            [attempt]="attempt!"
            [questions]="asImageMatchingQuestions()"
            [shuffledWords]="shuffledWords"
            [gameSet]="set!"
            (onComplete)="handleImageMatchComplete($event)"
          ></app-image-matching>

          <app-gender-stack
            *ngIf="phase === 'playing' && set?.gameType === 'gender_stack' && attempt && set"
            [attempt]="attempt!"
            [gameSet]="set"
            [questions]="asGenderStackQuestions()"
            (onComplete)="handleGenderStackComplete($event)"
          ></app-gender-stack>

          <app-flapjugation
            *ngIf="phase === 'playing' && set?.gameType === 'flapjugation' && attempt"
            [questions]="asFlapjugationQuestions()"
            (onComplete)="handleFlapjugationComplete($event)"
          ></app-flapjugation>

          <app-whackawort
            *ngIf="phase === 'playing' && set?.gameType === 'whackawort' && attempt"
            [attempt]="attempt!"
            [questions]="asWhackawortQuestions()"
            (onComplete)="handleWhackawortComplete($event)"
          ></app-whackawort>

          <app-jumbled-words
            *ngIf="phase === 'playing' && set?.gameType === 'jumbled_words' && attempt && set"
            [attempt]="attempt!"
            [gameSet]="set"
            [questions]="asJumbledWordsQuestions()"
            (onComplete)="handleJumbledWordsComplete($event)"
          ></app-jumbled-words>

          <app-memory-game
            *ngIf="phase === 'playing' && set?.gameType === 'memory' && attempt && set"
            [attempt]="attempt!"
            [gameSet]="set"
            [questions]="asMemoryQuestions()"
            (onComplete)="handleMemoryComplete($event)"
          ></app-memory-game>

          <app-hangman-game
            *ngIf="phase === 'playing' && set?.gameType === 'hangman' && attempt && set"
            [attempt]="attempt!"
            [gameSet]="set"
            [questions]="asHangmanQuestions()"
            (onComplete)="handleHangmanComplete($event)"
          ></app-hangman-game>

          <app-word-picture-match
            *ngIf="phase === 'playing' && set?.gameType === 'word_picture_match' && attempt && set"
            [attempt]="attempt!"
            [gameSet]="set"
            [questions]="asWordPictureMatchQuestions()"
            [shuffledWords]="shuffledWords"
            (onComplete)="handleWordPictureMatchComplete($event)"
          ></app-word-picture-match>

          <app-multiple-choice
            *ngIf="phase === 'playing' && set?.gameType === 'multiple_choice' && attempt && set"
            [attempt]="attempt!"
            [gameSet]="set"
            [questions]="asMultipleChoiceQuestions()"
            (onComplete)="handleMultipleChoiceComplete($event)"
          ></app-multiple-choice>

          <app-matching
            *ngIf="phase === 'playing' && set?.gameType === 'matching' && attempt"
            [attempt]="attempt!"
            [questions]="asMatchingQuestions()"
            [shuffledRightOptions]="shuffledWords"
            (onComplete)="handleMatchingComplete($event)"
          ></app-matching>

          <!-- Placeholder -->
          <div *ngIf="phase === 'playing' && isPlaceholderType()" class="shell__placeholder">
            <mat-icon>construction</mat-icon>
            <h3>Coming Soon</h3>
            <p>{{ set?.gameType }} game type is coming soon!</p>
            <button mat-raised-button (click)="back()">Back to GlückArena</button>
          </div>

          <!-- Results -->
          <div *ngIf="phase === 'results'" class="shell__results">
            <div class="shell__results__confetti">
              <span class="shell__results__c" style="--h:10;--x:80px;--y:-60px;--d:0s">✦</span>
              <span class="shell__results__c" style="--h:40;--x:-70px;--y:-50px;--d:0.3s">✦</span>
              <span class="shell__results__c" style="--h:50;--x:60px;--y:60px;--d:0.6s">✦</span>
              <span class="shell__results__c" style="--h:20;--x:-60px;--y:55px;--d:0.9s">✦</span>
              <span class="shell__results__c" style="--h:0;--x:90px;--y:-20px;--d:1.2s">✦</span>
              <span class="shell__results__c" style="--h:30;--x:-85px;--y:-10px;--d:1.5s">✦</span>
              <span class="shell__results__c" style="--h:55;--x:40px;--y:-70px;--d:0.15s">✦</span>
              <span class="shell__results__c" style="--h:15;--x:-40px;--y:70px;--d:0.45s">✦</span>
              <span class="shell__results__c" style="--h:45;--x:30px;--y:-40px;--d:0.75s">✦</span>
              <span class="shell__results__c" style="--h:5;--x:-30px;--y:-65px;--d:1.05s">✦</span>
            </div>
            <div class="shell__results__glow"></div>
            <div class="shell__results__score-wrap">
              <div class="shell__results__xp-sub">+{{ finalXp }} XP</div>
              <div class="shell__results__score-main">{{ finalScore }} <span>Score</span></div>
            </div>
            <div class="shell__results__meta">
              <mat-icon>timer</mat-icon>
              <span>{{ formatTime(finalTimeSeconds) }}</span>
              <span class="shell__results__dot">·</span>
              <mat-icon>track_changes</mat-icon>
              <span>{{ finalAccuracy }}%</span>
            </div>
            <div class="shell__results__actions">
              <button class="shell__results__btn shell__results__btn--replay" (click)="replay()">
                <mat-icon>replay</mat-icon> Play Again
              </button>
              <button class="shell__results__btn" routerLink="/glueck-arena/leaderboard">
                <mat-icon>leaderboard</mat-icon> Leaderboard
              </button>
              <button class="shell__results__btn shell__results__btn--outline" (click)="back()">
                <mat-icon>home</mat-icon> Back
              </button>
            </div>
          </div>

        </div>


        <!-- Leaderboard (right) -->
        <aside class="shell-game-wrap__right" *ngIf="!isAdminPreview">
          <div class="shell-side shell-side--lb">
            <div class="shell-side__lb">
              <header class="shell-side__lb-head">
                <h3><mat-icon>leaderboard</mat-icon> Leaderboard</h3>
                <a routerLink="/glueck-arena/leaderboard" class="shell-side__lb-link">See all</a>
              </header>
              <div class="lb__list" *ngIf="!lbLoading && lbEntries.length">
                <div class="lb__row" *ngFor="let e of lbEntries"
                  [class.lb__row--me]="isMe(e)"
                  [class.lb__row--top1]="e.rank === 1"
                  [class.lb__row--top2]="e.rank === 2"
                  [class.lb__row--top3]="e.rank === 3">
                  <div class="lb__row-body">
                    <div class="lb__rank-col">
                      <span class="lb__medal lb__medal--1" *ngIf="e.rank === 1" title="1st place"><mat-icon>emoji_events</mat-icon></span>
                      <span class="lb__medal lb__medal--2" *ngIf="e.rank === 2" title="2nd place"><mat-icon>military_tech</mat-icon></span>
                      <span class="lb__medal lb__medal--3" *ngIf="e.rank === 3" title="3rd place"><mat-icon>workspace_premium</mat-icon></span>
                      <span class="lb__rank-num" *ngIf="e.rank > 3">{{ e.rank }}</span>
                    </div>
                    <div class="lb__player">
                      <span class="lb__avatar" [class.lb__avatar--top]="e.rank <= 3">{{ playerInitials(e.name) }}</span>
                      <div class="lb__info">
                        <span class="lb__name">{{ e.name }} <span *ngIf="isMe(e)" class="lb__you">You</span></span>
                        <span class="lb__sub">{{ e.gamesCompleted }} games · Best {{ e.bestScore }} pts</span>
                      </div>
                    </div>
                  </div>
                  <div class="lb__row-footer">
                    <span class="lb__xp"><mat-icon>bolt</mat-icon>{{ e.totalXp }}</span>
                    <span class="lb__score"><mat-icon>stars</mat-icon>{{ e.bestScore }}</span>
                  </div>
                </div>
              </div>
              <div class="lb__list lb__list--skel" *ngIf="lbLoading">
                <div class="lb__row lb__row--skel" *ngFor="let _ of [1,2,3]"></div>
              </div>
              <div class="lb__empty" *ngIf="!lbLoading && !lbEntries.length">No rankings yet — play to appear here.</div>
            </div>
          </div>
        </aside>

      </div>

      <div class="shell__badge-popup" *ngIf="newBadges.length">
        <mat-icon>emoji_events</mat-icon>
        <div>
          <strong>Badge unlocked!</strong>
          <p *ngFor="let b of newBadges">{{ b.title }}</p>
        </div>
        <button mat-icon-button (click)="newBadges = []"><mat-icon>close</mat-icon></button>
      </div>

    </div>
  `,
  styles: [`
    .shell { width: 100%; max-width: 1320px; margin: 0 auto; padding: 16px 12px; box-sizing: border-box; }
    .shell-preview-banner {
      display: flex; align-items: center; gap: 10px; margin-bottom: 14px; padding: 12px 16px;
      border-radius: 12px; background: #eff6ff; border: 1px solid #93c5fd; color: #1e40af;
      font-size: 14px; font-weight: 600;
    }
    .shell-preview-banner mat-icon { color: #2563eb; }
    .shell__loading { padding: 0; }
    .shell__loading-grid { display: grid; grid-template-columns: 280px 1fr 300px; gap: 16px; width: 100%; margin: 0 auto; padding: 0; }
    .shell__loading-side, .shell__loading-right { display: flex; flex-direction: column; gap: 16px; }
    .shell__loading-main { display: flex; flex-direction: column; gap: 16px; }
    .shell__loading-block { border-radius: 20px; background: linear-gradient(90deg, #e8edf5 25%, #f5f7fa 50%, #e8edf5 75%); background-size: 200% 100%; animation: shell-skel 1.4s infinite; }
    @keyframes shell-skel { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
    .shell__error { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 64px; text-align: center; }
    .shell__error mat-icon { font-size: 48px; width: 48px; height: 48px; color: #c62828; }

    .shell-game-wrap {
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr) 280px;
      gap: 16px;
      align-items: start;
      width: 100%;
    }
    .shell-game-wrap__left {
      display: flex; flex-direction: column; gap: 16px;
      min-width: 0;
    }
    .shell-game-wrap__main { min-width: 0; display: flex; flex-direction: column; }
    .shell-game-wrap__right { min-width: 0; display: flex; flex-direction: column; }
    @media (max-width: 960px) {
      .shell-game-wrap { grid-template-columns: 250px 1fr; }
      .shell-game-wrap__right { grid-column: 1 / -1; }
    }
    @media (max-width: 720px) {
      .shell-game-wrap { grid-template-columns: 1fr; }
    }

    .shell-intro {
      display: flex; flex-direction: column; gap: 28px; flex: 1;
    }
    .shell-intro__top {
      display: grid; grid-template-columns: 1fr 320px; gap: 24px; align-items: start;
    }
    @media (max-width: 860px) { .shell-intro__top { grid-template-columns: 1fr; } }
    .shell-intro__main {
      position: relative; background: #fff; border-radius: 16px; overflow: hidden;
      box-shadow: 0 2px 12px rgba(15, 23, 42, 0.06);
      border: 1px solid #e2e8f0;
      flex: 1;
    }
    .shell-intro__banner {
      position: relative; width: 100%; height: 200px; overflow: hidden;
      display: flex; align-items: center; justify-content: center;
      border-bottom: 1px solid #e5e5e5;
    }
    .shell-intro__banner-img {
      position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
    }
    .shell-intro__banner-fallback {
      display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;
    }
    .shell-intro__banner-fallback mat-icon {
      font-size: 72px; width: 72px; height: 72px; color: rgba(255,255,255,.92);
    }
    .shell-intro__banner-xp {
      position: absolute; top: 16px; right: 16px; z-index: 2;
      padding: 6px 12px; border-radius: 999px; font-size: 13px; font-weight: 800; color: #fff;
      background: rgba(0,0,0,0.45); backdrop-filter: blur(6px);
    }
    .shell-intro__body { padding: 24px 28px 28px; }
    .shell-intro__tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
    .shell-tag {
      font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 999px;
      background: #eef2ff; color: #4338ca; text-transform: uppercase; letter-spacing: 0.04em;
      border: 1px solid #c7d2fe;
    }
    .shell-tag--muted { background: #f8fafc; color: #64748b; border-color: #e2e8f0; }
    .shell-intro__body h1 { margin: 0 0 8px; font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.01em; line-height: 1.25; }
    .shell-intro__desc { color: #64748b; line-height: 1.55; margin: 0 0 18px; font-size: 14px; }
    .shell-intro__stats {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px;
    }
    @media (max-width: 600px) { .shell-intro__stats { grid-template-columns: repeat(2, 1fr); } }
    .shell-intro__stat {
      text-align: center; padding: 10px 6px; border-radius: 12px;
      background: #f8fafc; border: 1px solid #e2e8f0;
      border-top: 2px solid #6366f1;
    }
    .shell-intro__stat mat-icon { color: #6366f1; font-size: 18px; width: 18px; height: 18px; }
    .shell-intro__stat strong { display: block; font-size: 16px; color: #1e293b; margin-top: 2px; }
    .shell-intro__stat span { font-size: 10px; color: #94a3b8; text-transform: uppercase; font-weight: 600; }
    .shell-intro__actions { display: flex; justify-content: center; }
    .shell-intro__start {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      min-width: 180px; padding: 12px 28px; border-radius: 12px; border: none; cursor: pointer;
      font-size: 15px; font-weight: 700; color: #fff;
      background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%);
      box-shadow: 0 4px 16px rgba(37, 99, 235, 0.3);
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .shell-intro__start:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(37, 99, 235, 0.35); }
    .shell-intro__start mat-icon { font-size: 22px; width: 22px; height: 22px; color: #fff; }
    .shell-intro__info { margin-top: 24px; padding-top: 20px; border-top: 1px solid #e2e8f0; }

    .shell-side__info {
      position: sticky; top: 16px;
      background: #fff; border-radius: 16px; padding: 24px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 2px 12px rgba(15, 23, 42, 0.06);
      overflow: hidden;
      flex: 1;
    }
    .shell-side__back {
      position: absolute; top: 12px; left: 12px;
      display: flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; border: none; border-radius: 10px;
      background: #f1f5f9; cursor: pointer; z-index: 1;
      color: #475569; transition: background 0.15s;
      padding: 0;
    }
    .shell-side__back:hover { background: #e2e8f0; }
    .shell-side__back mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .sb-panel__game { text-align: center; margin-bottom: 18px; }
    .sb-panel__thumb {
      width: 100%; height: 130px; border-radius: 12px; margin: 0 auto 12px;
      display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative;
      border: 1px solid #e2e8f0;
      box-shadow: none;
    }
    .sb-panel__thumb-img {
      position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
    }
    .sb-panel__thumb mat-icon { font-size: 40px; width: 40px; height: 40px; color: #fff; }
    .sb-panel__category { margin: 4px 0 0; font-size: 12px; color: #64748b; }
    .sb-panel__block--meta {
      display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; padding: 14px;
      background: #fafafa; border-radius: 10px; margin-bottom: 14px;
      border: 1px solid #e5e5e5;
    }
    .sb-panel__meta-row {
      display: flex; align-items: center; gap: 4px; font-size: 12px; color: #475569; font-weight: 600; border: 1px solid #e5e5e5; border-radius: 4px; padding: 2px 6px;
    }
    .sb-panel__meta-row mat-icon { font-size: 16px; width: 16px; height: 16px; color: #f59e0b; }
    .shell-side__info h2 { margin: 0 0 3px; font-size: 14px; font-weight: 700; color: #1e293b; line-height: 1.3; }
    .sb-panel__type { margin: 0; font-size: 10px; color: #16a34a; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }

    .shell-side {
      position: relative; background: #fff; border-radius: 16px; padding: 24px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 2px 12px rgba(15, 23, 42, 0.06);
      overflow: hidden;
      flex: 1;
      display: flex; flex-direction: column;
    }
    .shell-side__lb { flex: 1; display: flex; flex-direction: column; }
    .sb-panel__block { margin-bottom: 12px; }
    .sb-panel__block h3 {
      display: flex; align-items: center; gap: 6px;
      margin: 0 0 6px; font-size: 11px; font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.04em; color: #475569;
    }
    .sb-panel__block h3 mat-icon { font-size: 16px; width: 16px; height: 16px; color: #f59e0b; }
    .sb-panel__block p { font-size: 12px; color: #64748b; line-height: 1.5; margin: 0; }
    .shell-side__lb-head {
      display: flex; align-items: center; justify-content: space-between;
      margin: 4px 0 12px;
      padding: 0 0 10px;
      border-bottom: 1px solid #e5e5e5;
      background: none;
    }
    .shell-side__lb-head h3 {
      margin: 0; font-size: 13px; font-weight: 800; color: #1e293b;
      display: flex; align-items: center; gap: 6px;
    }
    .shell-side__lb-head h3 mat-icon { font-size: 18px; width: 18px; height: 18px; color: #f59e0b; }
    .shell-side__lb-link {
      font-size: 11px; font-weight: 700; color: #15803d; text-decoration: none;
    }
    .shell-side__lb-link:hover { text-decoration: underline; }
    .shell-side .lb__list { display: flex; flex-direction: column; gap: 10px; }
    .shell-side .lb__row {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 11px 12px;
      border-radius: 12px;
      background: #fafafa;
      border: 1px solid #e5e5e5;
      transition: transform 0.12s ease, box-shadow 0.12s ease;
    }
    .shell-side .lb__row-body {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .shell-side .lb__row:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .shell-side .lb__row--top1 {
      background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
      border-color: #16a34a;
      box-shadow: inset 3px 0 0 #15803d;
    }
    .shell-side .lb__row--top2 {
      background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
      border-color: #22c55e;
      box-shadow: inset 3px 0 0 #16a34a;
    }
    .shell-side .lb__row--top3 {
      background: linear-gradient(135deg, #f7fee7 0%, #ecfccb 100%);
      border-color: #65a30d;
      box-shadow: inset 3px 0 0 #84cc16;
    }
    .shell-side .lb__row--me { border-color: #111; box-shadow: inset 3px 0 0 #111; }
    .shell-side .lb__rank-col { display: flex; align-items: center; justify-content: center; }
    .shell-side .lb__medal {
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 30px; border-radius: 50%;
    }
    .shell-side .lb__medal mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .shell-side .lb__medal--1 { background: #15803d; color: #fff; box-shadow: 0 2px 8px rgba(21,128,61,0.35); }
    .shell-side .lb__medal--2 { background: #16a34a; color: #fff; box-shadow: 0 2px 6px rgba(22,163,74,0.3); }
    .shell-side .lb__medal--3 { background: #22c55e; color: #fff; box-shadow: 0 2px 6px rgba(34,197,94,0.25); }
    .shell-side .lb__rank-num {
      width: 26px; height: 26px; border-radius: 8px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 800; color: #64748b; background: #f1f5f9; border: 1px solid #e2e8f0;
    }
    .shell-side .lb__player { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .shell-side .lb__avatar {
      width: 32px; height: 32px; border-radius: 10px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 800; color: #475569; background: #f1f5f9; border: 1px solid #e2e8f0;
    }
    .shell-side .lb__avatar--top { background: #dcfce7; color: #15803d; border-color: #86efac; }
    .shell-side .lb__info { min-width: 0; overflow: hidden; }
    .shell-side .lb__name {
      display: block; font-size: 13px; font-weight: 700; color: #1e293b;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .shell-side .lb__sub { display: block; font-size: 10px; color: #64748b; margin-top: 1px; }
    .shell-side .lb__you {
      display: inline-block; margin-left: 4px; padding: 1px 6px; border-radius: 999px;
      font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em;
      color: #15803d; background: #dcfce7; border: 1px solid #86efac;
    }
    .shell-side .lb__row-footer {
      display: flex;
      justify-content: flex-start;
      align-items: center;
      gap: 8px;
    }
    .shell-side .lb__score {
      display: inline-flex; align-items: center; gap: 2px;
      font-size: 13px; font-weight: 800; color: #92400e; white-space: nowrap;
      padding: 4px 8px; border-radius: 999px; background: #fef3c7; border: 1px solid #fde68a;
    }
    .shell-side .lb__score mat-icon { font-size: 14px !important; width: 14px !important; height: 14px !important; color: #f59e0b; }
    .shell-side .lb__xp {
      display: inline-flex; align-items: center; gap: 2px;
      font-size: 13px; font-weight: 800; color: #15803d; white-space: nowrap;
      padding: 4px 8px; border-radius: 999px; background: #ecfdf5; border: 1px solid #bbf7d0;
    }
    .shell-side .lb__xp mat-icon { font-size: 14px !important; width: 14px !important; height: 14px !important; color: #16a34a; }
    .shell-side .lb__row--skel {
      height: 43px; cursor: default;
      background: linear-gradient(90deg, #e8edf5 25%, #f5f7fa 50%, #e8edf5 75%);
      background-size: 200% 100%;
      animation: skel 1.4s infinite;
    }
    .shell-side .lb__empty {
      font-size: 12px; color: #94a3b8; text-align: center; padding: 12px 8px; line-height: 1.45;
    }
    .shell-side--lb { position: sticky; top: 16px; height: 100%; }

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

    .shell__results { position: relative; text-align: center; padding: 48px 24px; background: #fff; border-radius: 20px; box-shadow: 0 4px 20px rgba(0,0,0,.1); display: flex; flex-direction: column; align-items: center; gap: 10px; overflow: hidden; }
    .shell__results__glow { position: absolute; top: 50%; left: 50%; width: 300px; height: 300px; transform: translate(-50%,-50%); border-radius: 50%; background: radial-gradient(circle, rgba(245,158,11,.12) 0%, transparent 70%); pointer-events: none; }
    .shell__results__confetti { position: absolute; inset: 0; pointer-events: none; }
    .shell__results__c { position: absolute; top: 50%; left: 50%; font-size: 12px; color: hsl(calc(var(--h)*3.6), 100%, 60%); opacity: 0; animation: res-confetti-loop 2.5s ease-in-out infinite; animation-delay: var(--d); }
    @keyframes res-confetti-loop {
      0% { opacity: 0; transform: translate(-50%,-50%) scale(0) rotate(0); }
      15% { opacity: 1; transform: translate(calc(-50% + var(--x)*0.3), calc(-50% + var(--y)*0.3)) scale(1.2) rotate(calc(var(--h)*10deg)); }
      40% { opacity: 1; transform: translate(calc(-50% + var(--x)*0.7), calc(-50% + var(--y)*0.7)) scale(0.9) rotate(calc(var(--h)*20deg)); }
      70% { opacity: 0.6; transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y))) scale(0.4) rotate(calc(var(--h)*40deg)); }
      100% { opacity: 0; transform: translate(calc(-50% + var(--x)*1.3), calc(-50% + var(--y)*1.3)) scale(0) rotate(calc(var(--h)*60deg)); }
    }
    .shell__results__score-wrap { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .shell__results__xp-sub { font-size: 20px; font-weight: 800; background: linear-gradient(135deg,#f59e0b,#ffc107,#f59e0b); background-size: 200% 100%; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; animation: res-shimmer 2s linear infinite; }
    @keyframes res-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .shell__results__score-main { font-size: 56px; font-weight: 900; color: #0f172a; line-height: 1; letter-spacing: -0.03em; }
    .shell__results__score-main span { display: block; font-size: 14px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }
    .shell__results__meta { display: flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 600; color: #64748b; }
    .shell__results__meta mat-icon { font-size: 20px !important; width: 20px !important; height: 20px !important; color: #6366f1; }
    .shell__results__dot { color: #cbd5e1; font-weight: 800; }
    .shell__results__actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; justify-content: center; }
    .shell__results__btn { display: flex; align-items: center; gap: 6px; padding: 12px 24px; border: none; border-radius: 12px; cursor: pointer; font-size: 15px; font-weight: 700; color: #fff; background: linear-gradient(135deg, #1e3a5f, #2563eb); box-shadow: 0 4px 16px rgba(37,99,235,.3); transition: transform .15s, box-shadow .15s; text-decoration: none; }
    .shell__results__btn:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(37,99,235,.4); }
    .shell__results__btn--replay { background: linear-gradient(135deg, #f59e0b, #ea580c); box-shadow: 0 4px 16px rgba(245,158,11,.35); }
    .shell__results__btn--replay:hover { box-shadow: 0 8px 24px rgba(245,158,11,.45); }
    .shell__results__btn--outline { background: transparent; color: #64748b; box-shadow: none; border: 2px solid #e2e8f0; }
    .shell__results__btn--outline:hover { border-color: #94a3b8; color: #0f172a; box-shadow: none; }
    .shell__results__btn mat-icon { font-size: 20px !important; width: 20px !important; height: 20px !important; }
    .shell__badge-popup {
      position: fixed; bottom: 24px; right: 24px; z-index: 100;
      display: flex; align-items: flex-start; gap: 12px;
      background: linear-gradient(135deg,#ff8f00,#ffc107); color: #fff;
      padding: 16px 20px; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,.2);
      max-width: 320px; animation: badgePop .4s ease;
    }
    .shell__badge-popup mat-icon { font-size: 36px; width: 36px; height: 36px; }
    @keyframes badgePop { from { transform: scale(.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    @keyframes skel { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
  `]
})
export class GamePlayShellComponent implements OnInit {
  phase: 'loading' | 'intro' | 'playing' | 'results' | 'error' = 'loading';
  error = '';
  set: GameSet | null = null;
  attempt: GameAttempt | null = null;
  questions: GameQuestion[] = [];
  shuffledWords: string[] = [];
  levels: GameLevel[] = [];
  finalScore = 0;
  finalXp = 0;
  finalAccuracy = 0;
  finalTimeSeconds = 0;
  newBadges: AchievementDto[] = [];
  gameLeaderboard: LeaderboardEntry[] = [];
  leaderboardLoading = false;
  myGameRank: number | null = null;

  lbEntries: LeaderboardEntry[] = [];
  lbLoading = false;

  isAdminPreview = false;
  thumbnailBroken = false;
  private thumbnailUrl = '';

  constructor(
    private svc: InteractiveGameService,
    private mediaService: DigitalExerciseService,
    private notify: NotificationService,
    private route: ActivatedRoute,
    private router: Router,
    private auth: AuthService
  ) {}

  private get arenaExitPath(): string {
    return this.isAdminPreview ? '/admin/glueck-arena' : '/glueck-arena';
  }

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
    this.isAdminPreview = !!this.route.snapshot.data['arenaPreview'];
    if (!this.isAdminPreview) {
      this.loadLeaderboard();
    }
    this.svc.startAttempt(id).subscribe({
      next: (r) => {
        this.set = r.set;
        this.attempt = r.attempt;
        this.questions = r.questions;
        this.shuffledWords = r.shuffledWords || [];
        this.levels = r.levels || [];
        this.phase = 'intro';
        if (r.preview) this.isAdminPreview = true;
        this.thumbnailBroken = false;
        this.resolveThumbnail(this.set?.thumbnailUrl);
        if (!this.isAdminPreview) {
          this.fetchGameLeaderboard(id);
        }
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

  getThumbnailUrl(set: GameSet | null): string {
    if (!set) return '';
    return this.thumbnailUrl || set.thumbnailUrl || '';
  }

  onThumbnailError(): void {
    this.thumbnailBroken = true;
  }

  private resolveThumbnail(url: string | null | undefined): void {
    const raw = String(url || '').trim();
    this.thumbnailUrl = raw;
    if (!raw) return;
    this.mediaService.resolveMediaFromR2([raw]).subscribe({
      next: (res) => {
        const hit = (res.resolutions || []).find((row) => row.original === raw);
        if (hit?.url) this.thumbnailUrl = hit.url;
      }
    });
  }

  loadLeaderboard() {
    this.lbLoading = true;
    this.svc.getGlobalLeaderboard('all').subscribe({
      next: (r) => {
        this.lbEntries = (r.leaderboard || []).slice(0, 5).map(row => ({
          ...row,
          totalXp: row.totalXp ?? 0,
          gamesCompleted: row.gamesCompleted ?? 0,
          bestScore: row.bestScore ?? 0,
        }));
        this.lbLoading = false;
      },
      error: () => { this.lbLoading = false; }
    });
  }

  isMe(e: LeaderboardEntry): boolean {
    if (!this.lbEntries.length) return false;
    return String(e.studentId) === String(this.attempt?.studentId);
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

  replay() { window.location.reload(); }

  back() { this.router.navigate([this.arenaExitPath]); }

  asSentenceQuestions(): SentenceQuestion[] { return this.questions as SentenceQuestion[]; }
  asScrambleQuestions(): ScrambleQuestion[] { return this.questions as ScrambleQuestion[]; }
  asImageMatchingQuestions(): ImageMatchingQuestion[] { return this.questions as ImageMatchingQuestion[]; }
  asGenderStackQuestions(): GenderStackQuestion[] { return this.questions as GenderStackQuestion[]; }
  asFlapjugationQuestions(): FlapjugationQuestion[] { return this.questions as FlapjugationQuestion[]; }
  asWhackawortQuestions(): WhackawortQuestion[] { return this.questions as WhackawortQuestion[]; }
  asJumbledWordsQuestions(): JumbledWordsQuestion[] { return this.questions as JumbledWordsQuestion[]; }
  asMemoryQuestions(): MemoryGameQuestion[] { return this.questions as MemoryGameQuestion[]; }
  asHangmanQuestions(): HangmanQuestion[] { return this.questions as HangmanQuestion[]; }
  asWordPictureMatchQuestions(): WordPictureMatchQuestion[] { return this.questions as WordPictureMatchQuestion[]; }
  asMultipleChoiceQuestions(): MultipleChoiceQuestion[] { return this.questions as MultipleChoiceQuestion[]; }
  asMatchingQuestions(): MatchingQuestion[] { return this.questions as MatchingQuestion[]; }

  isPlaceholderType(): boolean {
    return ['flashcards'].includes(this.set?.gameType ?? '');
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
        if (!r.preview && (r.xpBonus ?? 0) > 0) {
          this.notify.success(`🎉 +${r.xpBonus} XP earned!`);
        } else if (r.preview) {
          this.notify.success('Preview complete');
        }
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
        if (!r.preview && (r.xpBonus ?? 0) > 0) {
          this.notify.success(`🎉 +${r.xpBonus} XP earned!`);
        } else if (r.preview) {
          this.notify.success('Preview complete');
        }
      },
      error: () => { this.phase = 'results'; }
    });
  }

  handleImageMatchComplete(result: IMResult) {
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

  handleGenderStackComplete(result: GSResult) {
    this.finalScore = result.score;
    this.finalAccuracy = result.accuracy;
    this.finalTimeSeconds = result.timeSpentSeconds;
    if (!this.attempt) return;

    this.svc.completeAttempt(this.attempt._id, {
      timeSpentSeconds: result.timeSpentSeconds,
      livesRemaining: result.livesRemaining,
    }).subscribe({
      next: (r) => {
        this.finalXp = r.xpBonus ?? 0;
        this.newBadges = r.newAchievements || [];
        this.phase = 'results';
        if (!r.preview && (r.xpBonus ?? 0) > 0) {
          this.notify.success(`🎉 +${r.xpBonus} XP earned!`);
        } else if (r.preview) {
          this.notify.success('Preview complete');
        }
      },
      error: () => { this.phase = 'results'; }
    });
  }

  handleFlapjugationComplete(result: FJResult) {
    this.finalScore = result.score;
    this.finalAccuracy = result.accuracy;
    this.finalTimeSeconds = result.timeSpentSeconds;
    if (!this.attempt) return;

    this.svc.completeAttempt(this.attempt._id, {
      timeSpentSeconds: result.timeSpentSeconds,
      livesRemaining: result.livesRemaining,
    }).subscribe({
      next: (r) => {
        this.finalXp = r.xpBonus ?? 0;
        this.newBadges = r.newAchievements || [];
        this.phase = 'results';
        if (!r.preview && (r.xpBonus ?? 0) > 0) {
          this.notify.success(`🎉 +${r.xpBonus} XP earned!`);
        } else if (r.preview) {
          this.notify.success('Preview complete');
        }
      },
      error: () => { this.phase = 'results'; }
    });
  }

  handleMatchingComplete(result: MatchResult) {
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
        if (!r.preview && (r.xpBonus ?? 0) > 0) {
          this.notify.success(`🎉 +${r.xpBonus} XP earned!`);
        } else if (r.preview) {
          this.notify.success('Preview complete');
        }
      },
      error: () => { this.phase = 'results'; }
    });
  }

  handleWhackawortComplete(result: WWResult) {
    this.finalScore = result.score;
    this.finalAccuracy = result.accuracy;
    this.finalTimeSeconds = result.timeSpentSeconds;
    if (!this.attempt) return;

    this.svc.completeAttempt(this.attempt._id, {
      timeSpentSeconds: result.timeSpentSeconds,
      livesRemaining: result.livesRemaining,
    }).subscribe({
      next: (r) => {
        this.finalXp = r.xpBonus ?? 0;
        this.newBadges = r.newAchievements || [];
        this.phase = 'results';
        if (!r.preview && (r.xpBonus ?? 0) > 0) {
          this.notify.success(`🎉 +${r.xpBonus} XP earned!`);
        } else if (r.preview) {
          this.notify.success('Preview complete');
        }
      },
      error: () => { this.phase = 'results'; }
    });
  }

  handleMemoryComplete(result: MemoryResult) {
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
        if (!r.preview && (r.xpBonus ?? 0) > 0) {
          this.notify.success(`🎉 +${r.xpBonus} XP earned!`);
        } else if (r.preview) {
          this.notify.success('Preview complete');
        }
      },
      error: () => { this.phase = 'results'; }
    });
  }

  handleJumbledWordsComplete(result: JWResult) {
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
        if (!r.preview && (r.xpBonus ?? 0) > 0) {
          this.notify.success(`🎉 +${r.xpBonus} XP earned!`);
        } else if (r.preview) {
          this.notify.success('Preview complete');
        }
      },
      error: () => { this.phase = 'results'; }
    });
  }

  handleHangmanComplete(result: HangmanResult) {
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
        if (!r.preview && (r.xpBonus ?? 0) > 0) {
          this.notify.success(`🎉 +${r.xpBonus} XP earned!`);
        } else if (r.preview) {
          this.notify.success('Preview complete');
        }
      },
      error: () => { this.phase = 'results'; }
    });
  }

  handleMultipleChoiceComplete(result: MCResult) {
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
        if (!r.preview && (r.xpBonus ?? 0) > 0) {
          this.notify.success(`🎉 +${r.xpBonus} XP earned!`);
        } else if (r.preview) {
          this.notify.success('Preview complete');
        }
      },
      error: () => { this.phase = 'results'; }
    });
  }

  handleWordPictureMatchComplete(result: WPMResult) {
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
        if (!r.preview && (r.xpBonus ?? 0) > 0) {
          this.notify.success(`🎉 +${r.xpBonus} XP earned!`);
        } else if (r.preview) {
          this.notify.success('Preview complete');
        }
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
      matching: 'Matching', flashcards: 'Flashcards', image_matching: 'Image Matching',
      gender_stack: 'Gender Stack', flapjugation: 'Flapjugation',
      whackawort: 'Whack-a-Wort', memory: 'Memory Game',
      jumbled_words: 'Jumbled Words', hangman: 'Hangman',
      word_picture_match: 'Word-Picture Match',
      multiple_choice: 'Multiple Choice',
    };
    return map[t] ?? t;
  }

  getTypeColor(type: string): string {
    const map: Record<string, string> = {
      scramble_rush: 'linear-gradient(135deg,#1565c0,#42a5f5)',
      sentence_builder: 'linear-gradient(135deg,#2e7d32,#66bb6a)',
      image_matching: 'linear-gradient(135deg,#7c3aed,#a78bfa)',
      gender_stack: 'linear-gradient(135deg,#0ea5e9,#38bdf8)',
      flapjugation: 'linear-gradient(135deg,#be185d,#ec4899)',
      whackawort: 'linear-gradient(135deg,#d97706,#f59e0b)',
      memory: 'linear-gradient(135deg,#0891b2,#22d3ee)',
      jumbled_words: 'linear-gradient(135deg,#7c3aed,#a78bfa)',
      hangman: 'linear-gradient(135deg,#b91c1c,#ef4444)',
      matching: 'linear-gradient(135deg,#15803d,#4ade80)',
      word_picture_match: 'linear-gradient(135deg,#0d9488,#2dd4bf)',
      multiple_choice: 'linear-gradient(135deg,#0891b2,#22d3ee)',
    };
    return map[type] ?? 'linear-gradient(135deg,#405980,#7a9cc0)';
  }
}
