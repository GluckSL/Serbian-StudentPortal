import {

  Component, Input, Output, EventEmitter, OnInit, OnDestroy,

  ViewChild, ElementRef, HostListener, NgZone

} from '@angular/core';

import { CommonModule } from '@angular/common';

import { FormsModule } from '@angular/forms';

import { MaterialModule } from '../../../../shared/material.module';

import { GameHudComponent } from '../../shared/game-hud/game-hud.component';

import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';

import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';

import { InteractiveGameService } from '../../services/interactive-game.service';

import { GameAudioService } from '../../services/game-audio.service';

import { ScrambleQuestion, GameAttempt, GameLevel } from '../../glueck-arena.types';



export interface SRResult {

  score: number;

  accuracy: number;

  timeSpentSeconds: number;

  livesRemaining: number;

  currentLevel: number;

}



interface FallingWord {

  id: number;

  question: ScrambleQuestion;

  x: number;

  y: number;

  speed: number;

  display: string;

  state: 'falling' | 'hit' | 'missed';

  spawnedAt: number;

  /** Wall-clock ms when this word must be answered (matches per-word timer bar). */
  deadlineAt: number;

  /** Brief red shake after a wrong guess */
  wrongFlash?: boolean;

  /** Cached timer percentage to avoid ExpressionChangedAfterItHasBeenCheckedError */
  timeLeftPct?: number;

}



/** Deadline Y% — word must be answered before it crosses this line */

const DEADLINE_Y = 88;



@Component({

  selector: 'app-scramble-rush',

  standalone: true,

  imports: [CommonModule, FormsModule, MaterialModule, GameHudComponent, XpFloatComponent, ConfettiBurstComponent],

  template: `

    <div class="sr" (click)="focusInput()">

      <app-game-hud

        [lives]="lives"

        [maxLives]="maxLives"

        [score]="score"

        [timeLeft]="timeLeft"

        [level]="currentLevelNum"

        [current]="wordsAnswered"

        [total]="totalWords"

        [showLives]="true"

        (pause)="onPause()"

      ></app-game-hud>



      <div class="sr__meta" *ngIf="phase === 'playing'">

        <span class="sr__meta-chip">

          <mat-icon>arrow_downward</mat-icon>

          {{ displayFallSeconds }}s for this word

        </span>

        <div class="sr__level-progress" *ngIf="totalWords > 0">

          <div class="sr__level-progress__fill" [style.width.%]="levelProgressPercent"></div>

        </div>

      </div>



      <div class="sr__playfield">

        <aside class="sr__buddy" aria-hidden="true">

          <img

            class="sr__buddy-img"

            src="assets/images/practice-partner-fox.svg"

            alt=""

            width="200"

            height="200"

            loading="lazy"

            decoding="async"

          />

        </aside>

        <div class="sr__stage">

        <div class="sr__arena" #arena>

          <div class="sr__sky"></div>

          <div class="sr__line" aria-hidden="true">

            <span class="sr__line-label">Answer before the line</span>

          </div>



          <div

            *ngFor="let w of fallingWords"

            class="sr__tile"

            [class.sr__tile--hit]="w.state === 'hit'"

            [class.sr__tile--missed]="w.state === 'missed'"

            [class.sr__tile--wrong-flash]="w.wrongFlash"

            [class.sr__tile--urgent]="w.state === 'falling' && getWordUrgency(w) >= 0.7 && !w.wrongFlash"

            [style.left]="w.x + '%'"

            [style.top]="w.y + '%'"

          >

            <div class="sr__tile__blast" *ngIf="w.state === 'hit'" aria-hidden="true"></div>

            <div class="sr__tile__blast-ring" *ngIf="w.state === 'hit'" aria-hidden="true"></div>

            <div class="sr__tile__timer" *ngIf="w.state === 'falling'">

              <div class="sr__tile__timer-fill" [style.width.%]="w.timeLeftPct"></div>

            </div>

            <span class="sr__tile__letters">{{ w.display }}</span>

            <span class="sr__tile__hint" *ngIf="w.question.hint">{{ w.question.hint }}</span>

            <button type="button" class="sr__tile__audio" *ngIf="w.question.audioUrl"

              (click)="$event.stopPropagation(); audio.playUrl(w.question.audioUrl)">

              <mat-icon>volume_up</mat-icon>

            </button>

          </div>



          <div class="sr__feedback sr__feedback--correct" *ngIf="feedbackState === 'correct'">

            <mat-icon>check_circle</mat-icon> Correct!

          </div>

          <div class="sr__feedback sr__feedback--wrong" *ngIf="feedbackState === 'wrong'">

            <mat-icon>cancel</mat-icon> Wrong!

          </div>



          <div class="sr__level-banner" *ngIf="levelBanner">

            Level {{ levelBanner }}

          </div>



          <div class="sr__overlay" *ngIf="phase === 'complete' || phase === 'gameover'">

            <div class="sr__overlay-card">

              <mat-icon class="sr__overlay-icon" [class.sr__overlay-icon--win]="phase === 'complete'">

                {{ phase === 'complete' ? 'emoji_events' : 'sentiment_dissatisfied' }}

              </mat-icon>

              <h2>{{ phase === 'complete' ? 'Level Complete!' : 'Game Over' }}</h2>

              <div class="sr__overlay-stats">

                <div class="sr__overlay-stat">

                  <span class="sr__overlay-stat-val">{{ score }}</span>

                  <span class="sr__overlay-stat-lbl">Score</span>

                </div>

                <div class="sr__overlay-stat">

                  <span class="sr__overlay-stat-val">{{ accuracy }}%</span>

                  <span class="sr__overlay-stat-lbl">Accuracy</span>

                </div>

                <div class="sr__overlay-stat">

                  <span class="sr__overlay-stat-val">{{ wordsAnswered }}/{{ totalWords }}</span>

                  <span class="sr__overlay-stat-lbl">Words</span>

                </div>

              </div>

              <button mat-raised-button color="primary" class="sr__overlay-btn" (click)="onComplete.emit(buildResult())">

                <mat-icon>stars</mat-icon>

                Finish & Collect XP

              </button>

            </div>

          </div>

        </div>



        <div class="sr__input-bar" *ngIf="phase === 'playing'" [class.sr__input-bar--shake]="inputShake">

          <mat-icon class="sr__input-icon">keyboard</mat-icon>

          <input

            #wordInput

            class="sr__input"

            type="text"

            [(ngModel)]="typedWord"

            (keyup.enter)="submitWord()"

            [disabled]="phase !== 'playing'"

            autocomplete="off"

            autocorrect="off"

            spellcheck="false"

            [placeholder]="'Type the unscrambled word (' + displayFallSeconds + 's)…'"

            inputmode="text"

          >

          <button mat-fab color="primary" class="sr__submit"

            (click)="submitWord()"

            [disabled]="!typedWord.trim() || phase !== 'playing'"

            aria-label="Submit word">

            <mat-icon>send</mat-icon>

          </button>

        </div>

      </div>

      </div>



      <app-xp-float [xp]="3" [trigger]="xpTrigger"></app-xp-float>

      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>

    </div>

  `,

  styles: [`

    .sr {

      display: flex;

      flex-direction: column;

      gap: 14px;

      padding: 16px 18px 28px;

      max-width: 960px;

      margin: 0 auto;

      width: 100%;

      box-sizing: border-box;

      position: relative;

      border-radius: 24px;

      background:
        radial-gradient(ellipse 120% 80% at 50% -20%, rgba(124, 58, 237, 0.35) 0%, transparent 55%),
        radial-gradient(ellipse 80% 60% at 100% 50%, rgba(56, 189, 248, 0.12) 0%, transparent 45%),
        linear-gradient(180deg, #070b14 0%, #0f172a 38%, #1a1033 100%);

      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.06),
        0 0 0 1px rgba(56, 189, 248, 0.15),
        0 24px 64px rgba(0, 0, 0, 0.45);

    }

    .sr::before {

      content: '';

      position: absolute;

      inset: 0;

      border-radius: 24px;

      background-image:
        linear-gradient(rgba(56, 189, 248, 0.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(56, 189, 248, 0.04) 1px, transparent 1px);

      background-size: 28px 28px;

      pointer-events: none;

      opacity: 0.5;

      mask-image: linear-gradient(180deg, black 0%, transparent 92%);

    }

    .sr__playfield {

      display: flex;

      flex-direction: row;

      align-items: stretch;

      gap: 8px;

      width: 100%;

    }

    .sr__buddy {

      flex: 0 0 148px;

      display: flex;

      align-items: flex-end;

      justify-content: center;

      margin: 0;

      padding: 0 4px 8px 0;

      pointer-events: none;

      min-height: 120px;

      align-self: flex-end;

    }

    .sr__buddy-img {

      width: 100%;

      max-width: 168px;

      height: auto;

      object-fit: contain;

      filter:
        drop-shadow(0 0 22px rgba(56, 189, 248, 0.35))
        drop-shadow(0 12px 28px rgba(0, 0, 0, 0.5));

      animation: buddy-float 3.2s ease-in-out infinite;

    }

    @keyframes buddy-float {

      0%, 100% { transform: translateY(0); }

      50% { transform: translateY(-8px); }

    }



    .sr__meta {

      display: flex;

      align-items: center;

      gap: 12px;

      flex-wrap: wrap;

    }



    .sr__meta-chip {

      display: inline-flex;

      align-items: center;

      gap: 6px;

      font-size: 13px;

      font-weight: 700;

      color: #e0e7ff;

      background: rgba(56, 189, 248, 0.12);

      border: 1px solid rgba(56, 189, 248, 0.35);

      padding: 7px 14px;

      border-radius: 20px;

      box-shadow: 0 0 20px rgba(56, 189, 248, 0.12);

    }

    .sr__meta-chip mat-icon {

      font-size: 16px;

      width: 16px;

      height: 16px;

      color: #38bdf8;

    }



    .sr__level-progress {

      flex: 1;

      min-width: 120px;

      height: 8px;

      background: rgba(15, 23, 42, 0.75);

      border-radius: 4px;

      overflow: hidden;

      border: 1px solid rgba(56, 189, 248, 0.2);

    }



    .sr__level-progress__fill {

      height: 100%;

      background: linear-gradient(90deg, #7c3aed, #38bdf8, #22d3ee);

      border-radius: 4px;

      transition: width 0.35s ease;

      box-shadow: 0 0 14px rgba(56, 189, 248, 0.55);

    }



    .sr__stage {

      display: flex;

      flex-direction: column;

      gap: 12px;

      flex: 1;

      min-width: 0;

      background: linear-gradient(180deg, rgba(15, 23, 42, 0.65) 0%, rgba(30, 27, 75, 0.45) 100%);

      border-radius: 24px;

      padding: 14px;

      box-shadow:
        0 0 0 1px rgba(167, 139, 250, 0.35),
        0 12px 40px rgba(0, 0, 0, 0.35),
        inset 0 1px 0 rgba(255, 255, 255, 0.05);

      border: 1px solid rgba(129, 140, 248, 0.35);

    }



    .sr__arena {

      position: relative;

      height: min(52vh, 420px);

      min-height: 300px;

      border-radius: 18px;

      overflow: hidden;

      border: 2px solid rgba(56, 189, 248, 0.45);

      background:
        radial-gradient(ellipse 90% 60% at 50% 0%, rgba(167, 139, 250, 0.35) 0%, transparent 55%),
        radial-gradient(ellipse 70% 45% at 85% 20%, rgba(56, 189, 248, 0.2) 0%, transparent 50%),
        linear-gradient(180deg, #0c1929 0%, #132a4a 42%, #1e3a5f 100%);

      box-shadow:
        inset 0 0 80px rgba(56, 189, 248, 0.08),
        0 0 32px rgba(8, 145, 178, 0.12);

    }



    .sr__sky {

      position: absolute;

      inset: 0;

      background:

        radial-gradient(ellipse 100px 50px at 20% 18%, rgba(56, 189, 248, 0.25) 0%, transparent 70%),

        radial-gradient(ellipse 120px 55px at 78% 12%, rgba(167, 139, 250, 0.2) 0%, transparent 70%),

        radial-gradient(1px 1px at 12% 25%, rgba(255,255,255,.55) 0%, transparent 100%),

        radial-gradient(1px 1px at 45% 18%, rgba(255,255,255,.45) 0%, transparent 100%),

        radial-gradient(1px 1px at 70% 35%, rgba(255,255,255,.4) 0%, transparent 100%),

        radial-gradient(1px 1px at 88% 22%, rgba(255,255,255,.5) 0%, transparent 100%);

      background-size: auto, auto, 220px 120px, 220px 120px, 220px 120px, 220px 120px;

      pointer-events: none;

    }



    .sr__line {

      position: absolute;

      bottom: 56px;

      left: 8px;

      right: 8px;

      height: 3px;

      background: repeating-linear-gradient(90deg, #f472b6 0, #f472b6 10px, transparent 10px, transparent 18px);

      box-shadow: 0 0 16px rgba(244, 114, 182, 0.6), 0 0 28px rgba(56, 189, 248, 0.35);

      z-index: 2;

    }



    .sr__line-label {

      position: absolute;

      top: -22px;

      left: 50%;

      transform: translateX(-50%);

      font-size: 11px;

      font-weight: 800;

      color: #fda4af;

      text-transform: uppercase;

      letter-spacing: 0.12em;

      white-space: nowrap;

      background: rgba(15, 23, 42, 0.9);

      padding: 4px 12px;

      border-radius: 8px;

      border: 1px solid rgba(244, 114, 182, 0.45);

      text-shadow: 0 0 12px rgba(244, 114, 182, 0.55);

    }



    .sr__tile {

      position: absolute;

      transform: translateX(-50%);

      background: linear-gradient(145deg, #f59e0b 0%, #ea580c 45%, #c026d3 130%);

      color: #fff;

      border-radius: 16px;

      padding: 10px 18px 8px;

      box-shadow:
        0 4px 20px rgba(234, 88, 12, 0.55),
        0 0 24px rgba(192, 38, 211, 0.35),
        inset 0 1px 0 rgba(255,255,255,.25);

      text-align: center;

      min-width: 88px;

      z-index: 3;

      border: 1px solid rgba(253, 224, 71, 0.35);

      transition: box-shadow 0.2s;

    }



    .sr__tile--urgent {

      box-shadow: 0 6px 24px rgba(198, 40, 40, 0.5);

      animation: tile-shake 0.4s ease-in-out infinite;

    }



    .sr__tile--hit {

      background: linear-gradient(145deg, #43a047, #2e7d32) !important;

      animation: tile-blast-green 0.7s ease-out forwards;

      z-index: 12;

    }



    .sr__tile--wrong-flash {

      background: linear-gradient(145deg, #ef5350, #b71c1c) !important;

      animation: tile-wrong-shake 0.55s ease-in-out;

      box-shadow: 0 0 28px rgba(229, 57, 53, 0.75);

      z-index: 11;

    }



    .sr__tile--missed {

      background: linear-gradient(145deg, #e53935, #c62828) !important;

      animation: tile-drop 0.4s ease-in forwards;

    }



    .sr__tile__blast {

      position: absolute;

      inset: -20px;

      border-radius: 50%;

      background: radial-gradient(circle, rgba(129, 199, 132, 0.95) 0%, rgba(46, 125, 50, 0.4) 45%, transparent 70%);

      animation: blast-expand 0.7s ease-out forwards;

      pointer-events: none;

    }



    .sr__tile__blast-ring {

      position: absolute;

      inset: -8px;

      border: 3px solid rgba(255, 255, 255, 0.9);

      border-radius: 20px;

      animation: blast-ring 0.7s ease-out forwards;

      pointer-events: none;

    }



    .sr__tile__timer {

      position: absolute;

      top: 0;

      left: 0;

      right: 0;

      height: 4px;

      background: rgba(0,0,0,.15);

      border-radius: 16px 16px 0 0;

      overflow: hidden;

    }



    .sr__tile__timer-fill {

      height: 100%;

      background: #fff;

      transition: none;

      will-change: width;

    }



    .sr__tile--urgent .sr__tile__timer-fill {

      background: #ffeb3b;

    }



    .sr__tile__letters {

      display: block;

      font-size: clamp(16px, 3vw, 22px);

      font-weight: 800;

      letter-spacing: 4px;

      margin-top: 4px;

    }



    .sr__tile__hint {

      display: block;

      font-size: 11px;

      opacity: 0.9;

      margin-top: 2px;

    }



    .sr__tile__audio {

      position: absolute;

      top: -10px;

      right: -10px;

      background: rgba(15, 23, 42, 0.9);

      color: #38bdf8;

      border: 1px solid rgba(56, 189, 248, 0.4);

      border-radius: 50%;

      width: 30px;

      height: 30px;

      cursor: pointer;

      display: flex;

      align-items: center;

      justify-content: center;

      padding: 0;

      box-shadow: 0 2px 12px rgba(0,0,0,.35);

    }



    .sr__tile__audio mat-icon { font-size: 16px; width: 16px; height: 16px; }



    .sr__feedback {

      position: absolute;

      top: 38%;

      left: 50%;

      transform: translate(-50%, -50%);

      display: flex;

      align-items: center;

      gap: 8px;

      padding: 12px 28px;

      border-radius: 24px;

      font-size: 20px;

      font-weight: 700;

      animation: feedback-pop 0.4s ease-out;

      z-index: 20;

      box-shadow: 0 8px 24px rgba(0,0,0,.15);

    }



    .sr__feedback--correct { background: #e8f5e9; color: #2e7d32; }

    .sr__feedback--wrong { background: #fce4ec; color: #b71c1c; }



    .sr__level-banner {

      position: absolute;

      inset: 0;

      display: flex;

      align-items: center;

      justify-content: center;

      font-size: clamp(28px, 8vw, 42px);

      font-weight: 900;

      font-style: italic;

      color: #f0abfc;

      text-shadow:
        0 0 24px rgba(192, 38, 211, 0.9),
        0 0 48px rgba(56, 189, 248, 0.5);

      z-index: 15;

      animation: level-banner 1.2s ease-out forwards;

      pointer-events: none;

      letter-spacing: 0.04em;

    }



    .sr__overlay {

      position: absolute;

      inset: 0;

      z-index: 30;

      display: flex;

      align-items: center;

      justify-content: center;

      background: rgba(18, 32, 56, 0.55);

      backdrop-filter: blur(6px);

      animation: overlay-in 0.3s ease;

    }



    .sr__overlay-card {

      text-align: center;

      padding: 32px 28px;

      background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);

      border-radius: 24px;

      border: 1px solid rgba(56, 189, 248, 0.25);

      box-shadow:
        0 0 40px rgba(124, 58, 237, 0.25),
        0 16px 48px rgba(0,0,0,.45);

      max-width: 340px;

      width: 90%;

      animation: card-pop 0.35s cubic-bezier(.34,1.56,.64,1);

    }



    .sr__overlay-icon {

      font-size: 72px;

      width: 72px;

      height: 72px;

      color: #94a3b8;

      display: block;

      margin: 0 auto 8px;

      filter: drop-shadow(0 0 12px rgba(56, 189, 248, 0.35));

    }



    .sr__overlay-icon--win { color: #ff8f00; }



    .sr__overlay-card h2 {

      margin: 0 0 20px;

      font-size: 26px;

      font-weight: 800;

      color: #f1f5f9;

    }



    .sr__overlay-stats {

      display: flex;

      justify-content: center;

      gap: 24px;

      margin-bottom: 24px;

    }



    .sr__overlay-stat { display: flex; flex-direction: column; align-items: center; }

    .sr__overlay-stat-val { font-size: 28px; font-weight: 800; color: #7dd3fc; }

    .sr__overlay-stat-lbl { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }



    .sr__overlay-btn {

      border-radius: 14px !important;

      padding: 0 24px !important;

      height: 48px;

    }



    .sr__input-bar {

      display: flex;

      align-items: center;

      gap: 12px;

      background: linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(30, 27, 75, 0.75));

      border-radius: 16px;

      padding: 10px 12px 10px 16px;

      border: 1px solid rgba(56, 189, 248, 0.35);

      box-shadow: 0 0 24px rgba(56, 189, 248, 0.1);

      transition: border-color 0.2s, box-shadow 0.2s;

    }



    .sr__input-bar--shake {

      animation: input-wrong-shake 0.55s ease-in-out;

      border-color: #e53935;

      background: linear-gradient(180deg, #ffebee, #fff);

    }



    @keyframes input-wrong-shake {

      0%, 100% { transform: translateX(0); }

      15% { transform: translateX(-6px); }

      30% { transform: translateX(6px); }

      45% { transform: translateX(-5px); }

      60% { transform: translateX(5px); }

    }



    .sr__input-icon { color: #38bdf8; opacity: 0.75; }



    .sr__input {

      flex: 1;

      border: none;

      background: transparent;

      padding: 12px 8px;

      font-size: 20px;

      font-weight: 800;

      text-transform: uppercase;

      letter-spacing: 2px;

      outline: none;

      color: #f1f5f9;

    }



    .sr__input::placeholder {

      text-transform: none;

      font-weight: 500;

      font-size: 14px;

      letter-spacing: 0;

      color: #64748b;

    }



    .sr__submit {

      flex-shrink: 0;

      width: 52px !important;

      height: 52px !important;

      box-shadow:
        0 0 20px rgba(56, 189, 248, 0.45),
        0 4px 14px rgba(124, 58, 237, 0.35) !important;

      background: linear-gradient(145deg, #2563eb, #7c3aed) !important;

    }



    .sr__submit mat-icon { margin-left: 2px; }



    @keyframes tile-blast-green {

      0% { transform: translateX(-50%) scale(1); filter: brightness(1); }

      35% { transform: translateX(-50%) scale(1.4); filter: brightness(1.2); box-shadow: 0 0 50px 16px rgba(76, 175, 80, 0.9); }

      100% { transform: translateX(-50%) scale(2.2); opacity: 0; filter: brightness(1.4); }

    }



    @keyframes blast-expand {

      0% { transform: scale(0.2); opacity: 1; }

      100% { transform: scale(2.5); opacity: 0; }

    }



    @keyframes blast-ring {

      0% { transform: scale(1); opacity: 1; }

      100% { transform: scale(2); opacity: 0; }

    }



    @keyframes tile-wrong-shake {

      0%, 100% { transform: translateX(-50%) translateY(0); }

      10% { transform: translateX(calc(-50% - 10px)) translateY(0); }

      20% { transform: translateX(calc(-50% + 10px)) translateY(-2px); }

      30% { transform: translateX(calc(-50% - 8px)) translateY(0); }

      40% { transform: translateX(calc(-50% + 8px)) translateY(2px); }

      50% { transform: translateX(calc(-50% - 6px)) translateY(0); }

      60% { transform: translateX(calc(-50% + 6px)) translateY(-1px); }

      70% { transform: translateX(calc(-50% - 4px)) translateY(0); }

      80% { transform: translateX(calc(-50% + 4px)) translateY(1px); }

    }



    @keyframes tile-drop {

      100% { transform: translateX(-50%) translateY(60px); opacity: 0; }

    }



    @keyframes tile-shake {

      0%, 100% { transform: translateX(-50%) rotate(0); }

      25% { transform: translateX(-50%) rotate(-2deg); }

      75% { transform: translateX(-50%) rotate(2deg); }

    }



    @keyframes feedback-pop {

      0% { transform: translate(-50%, -50%) scale(0.8); opacity: 0; }

      100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }

    }



    @keyframes overlay-in { from { opacity: 0; } to { opacity: 1; } }



    @keyframes card-pop {

      from { transform: scale(0.85); opacity: 0; }

      to { transform: scale(1); opacity: 1; }

    }



    @keyframes level-banner {

      0% { opacity: 0; transform: scale(0.6); }

      20% { opacity: 1; transform: scale(1.05); }

      80% { opacity: 1; transform: scale(1); }

      100% { opacity: 0; transform: scale(1.1); }

    }



    @media (max-width: 820px) {

      .sr__playfield { flex-direction: column; align-items: stretch; gap: 4px; }

      .sr__buddy {

        flex: 0 0 auto;

        order: -1;

        flex-direction: row;

        justify-content: center;

        padding: 4px 0 0;

        min-height: 0;

      }

      .sr__buddy-img { max-width: 96px; }

    }

    @media (max-width: 600px) {

      .sr { padding: 12px 12px 22px; border-radius: 18px; }

      .sr__arena { min-height: 260px; }

      .sr__overlay-stats { gap: 16px; }

      .sr__overlay-stat-val { font-size: 22px; }

    }

  `]

})

export class ScrambleRushComponent implements OnInit, OnDestroy {

  @Input() attempt!: GameAttempt;

  @Input() questions: ScrambleQuestion[] = [];

  @Input() levels: GameLevel[] = [];

  @Output() onComplete = new EventEmitter<SRResult>();



  @ViewChild('wordInput') wordInputRef!: ElementRef<HTMLInputElement>;



  phase: 'playing' | 'complete' | 'gameover' = 'playing';

  score = 0;

  lives = 3;

  maxLives = 3;

  currentLevelNum = 1;

  wordsAnswered = 0;

  correctCount = 0;

  typedWord = '';

  feedbackState: 'correct' | 'wrong' | null = null;

  levelBanner: number | null = null;

  inputShake = false;

  private submitting = false;

  fallingWords: FallingWord[] = [];

  private wordIdCounter = 0;

  private raf: number | null = null;

  private spawnTimer: ReturnType<typeof setInterval> | null = null;

  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  timeLeft: number | null = null;

  private questionPool: ScrambleQuestion[] = [];

  private usedQuestionIds = new Set<string>();



  xpTrigger = 0;

  showConfetti = false;

  private startTime = Date.now();
  private sessionEndsAt = 0;
  private lastFrameAt = 0;



  get totalWords(): number { return this.currentLevel?.wordsRequired ?? 5; }

  get accuracy(): number {

    return this.wordsAnswered > 0 ? Math.round((this.correctCount / this.wordsAnswered) * 100) : 0;

  }

  get currentLevel(): GameLevel | undefined {

    return this.levels.find(l => l.levelNumber === this.currentLevelNum) ?? this.levels[0];

  }

  /** Seconds shown in HUD — from the active falling word, or default 5 */
  get displayFallSeconds(): number {
    const active = this.fallingWords.find(w => w.state === 'falling');
    if (active) return this.getQuestionFallSeconds(active.question);
    return 5;
  }

  getQuestionFallSeconds(q: ScrambleQuestion): number {
    const sec = q.fallDurationSeconds ?? 5;
    return Math.min(30, Math.max(2, Math.round(sec)));
  }

  getQuestionFallMs(q: ScrambleQuestion): number {
    return this.getQuestionFallSeconds(q) * 1000;
  }

  getWordFallMs(w: FallingWord): number {
    return this.getQuestionFallMs(w.question);
  }

  get levelProgressPercent(): number {

    return this.totalWords > 0 ? Math.min(100, (this.wordsAnswered / this.totalWords) * 100) : 0;

  }



  constructor(

    private svc: InteractiveGameService,

    private zone: NgZone,

    readonly audio: GameAudioService

  ) {}



  ngOnInit() {

    this.audio.loadMutePreference();

    this.questionPool = [...this.questions];

    const lvl = this.currentLevel;

    if (lvl) {

      this.lives = lvl.lives;

      this.maxLives = lvl.lives;

      this.timeLeft = lvl.timeLimitSeconds;

    }

    this.showLevelBanner(this.currentLevelNum);

    this.startCountdown();

    this.startSpawning();

    this.startLoop();

    setTimeout(() => this.focusInput(), 300);

  }



  ngOnDestroy() {

    if (this.raf) cancelAnimationFrame(this.raf);

    if (this.spawnTimer) clearInterval(this.spawnTimer);

    if (this.countdownTimer) clearInterval(this.countdownTimer);

  }



  focusInput() {

    this.audio.unlock();

    if (this.phase === 'playing') {

      this.wordInputRef?.nativeElement?.focus();

    }

  }



  /** 0 = just spawned, 1 = at deadline line */
  getWordUrgency(w: FallingWord): number {
    const totalMs = this.getWordFallMs(w);
    const elapsed = Date.now() - w.spawnedAt;
    return Math.min(1, elapsed / totalMs);
  }

  /** Timer bar: 100% at spawn → 0% when this word's duration ends */
  getWordTimeLeftPercent(w: FallingWord): number {
    const totalMs = this.getWordFallMs(w);
    const remaining = w.deadlineAt - Date.now();
    return Math.max(0, Math.min(100, (remaining / totalMs) * 100));
  }



  startCountdown() {
    const lvl = this.currentLevel;
    if (!lvl) return;

    this.sessionEndsAt = Date.now() + lvl.timeLimitSeconds * 1000;
    this.syncSessionTimer();

    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = setInterval(() => {
      if (this.phase !== 'playing') {
        if (this.countdownTimer) clearInterval(this.countdownTimer);
        return;
      }
      this.syncSessionTimer();
      if ((this.timeLeft ?? 0) <= 0) this.endGame('gameover');
    }, 200);
  }

  private syncSessionTimer() {
    const leftMs = this.sessionEndsAt - Date.now();
    this.timeLeft = Math.max(0, Math.ceil(leftMs / 1000));
  }



  /** One word at a time — next spawns after current crosses the line or is answered */
  startSpawning() {
    if (this.spawnTimer) clearInterval(this.spawnTimer);
    this.spawnTimer = null;
    this.trySpawnNextWord();
  }

  hasActiveFallingWord(): boolean {
    return this.fallingWords.some(w => w.state === 'falling');
  }

  trySpawnNextWord() {
    if (this.phase !== 'playing') return;
    if (this.hasActiveFallingWord()) return;
    this.spawnWord();
  }

  spawnWord() {
    if (this.hasActiveFallingWord()) return;

    const available = this.questionPool.filter(q => !this.usedQuestionIds.has(q._id));

    if (!available.length) return;

    const q = available[Math.floor(Math.random() * available.length)];

    const letters = q.scrambledLetters || [];

    const now = Date.now();
    const perWordMs = this.getQuestionFallMs(q);
    const fw: FallingWord = {
      id: ++this.wordIdCounter,
      question: q,
      x: 10 + Math.random() * 75,
      y: 0,
      speed: 0,
      display: letters.join(' '),
      state: 'falling',
      spawnedAt: now,
      deadlineAt: now + perWordMs,
    };

    this.fallingWords.push(fw);

  }



  startLoop() {
    this.lastFrameAt = 0;
    const tick = (now: number) => {
      if (this.phase !== 'playing') return;
      const dt = this.lastFrameAt ? Math.min(now - this.lastFrameAt, 50) : 16.67;
      this.lastFrameAt = now;
      this.zone.run(() => this.updatePositions(dt));
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  updatePositions(dtMs: number) {
    const now = Date.now();

    this.fallingWords = this.fallingWords
      .map(w => {
        if (w.state !== 'falling') return w;

        const totalMs = this.getWordFallMs(w);
        const remaining = w.deadlineAt - now;
        w.timeLeftPct = Math.max(0, Math.min(100, (remaining / totalMs) * 100));

        const fallStep = (DEADLINE_Y / totalMs) * dtMs;
        const timedOut = now >= w.deadlineAt;
        const newY = Math.min(DEADLINE_Y, w.y + fallStep);

        if ((timedOut || newY >= DEADLINE_Y) && w.state === 'falling') {
          this.onWordCrossedLine(w);
          return { ...w, y: DEADLINE_Y, state: 'missed' as const };
        }
        return { ...w, y: newY };
      })
      .filter(w => w.state === 'falling' || w.state === 'hit' || w.state === 'missed');
  }

  onWordCrossedLine(w: FallingWord) {
    this.usedQuestionIds.add(w.question._id);
    this.lives = Math.max(0, this.lives - 1);

    setTimeout(() => {
      this.fallingWords = this.fallingWords.filter(x => x.id !== w.id);
      this.trySpawnNextWord();
      if (this.lives <= 0) {
        setTimeout(() => this.endGame('gameover'), 300);
      }
    }, 450);
  }



  submitWord() {

    const typed = this.typedWord.trim().toUpperCase();

    if (!typed || this.phase !== 'playing' || this.submitting) return;

    const target = this.fallingWords.find(w => w.state === 'falling');

    if (!target) { this.typedWord = ''; return; }

    this.submitting = true;
    this.svc.submitAnswer(this.attempt._id, {

      questionId: target.question._id,

      typedWord: typed,

      responseTimeMs: Date.now() - target.spawnedAt,

    }).subscribe({

      next: (r) => {
        this.submitting = false;
        this.typedWord = '';

        if (r.isCorrect) {

          this.onCorrect(target, r.pointsEarned);

        } else {

          this.onWrongAnswer(target);

        }

      },

      error: () => {
        this.submitting = false;
        this.typedWord = '';
      }

    });

  }



  onCorrect(fw: FallingWord, points: number) {

    fw.state = 'hit';

    this.usedQuestionIds.add(fw.question._id);

    this.score += points;

    this.correctCount++;

    this.wordsAnswered++;

    this.xpTrigger++;

    this.audio.playCorrect();

    this.triggerConfetti();

    setTimeout(() => {
      this.fallingWords = this.fallingWords.filter(w => w.id !== fw.id);
      if (this.wordsAnswered >= this.totalWords) {
        this.advanceLevel();
      } else {
        this.trySpawnNextWord();
      }
    }, 720);
  }

  onWrongAnswer(fw: FallingWord) {
    this.audio.playWrong();
    fw.wrongFlash = true;
    this.inputShake = true;
    setTimeout(() => {
      fw.wrongFlash = false;
      this.inputShake = false;
    }, 580);
  }



  advanceLevel() {

    const nextLevelNum = this.currentLevelNum + 1;

    const nextLevel = this.levels.find(l => l.levelNumber === nextLevelNum);

    if (!nextLevel) {

      this.endGame('complete');

      return;

    }

    this.currentLevelNum = nextLevelNum;

    this.lives = nextLevel.lives;

    this.maxLives = nextLevel.lives;

    this.wordsAnswered = 0;

    this.fallingWords = [];

    if (this.spawnTimer) clearInterval(this.spawnTimer);

    this.showLevelBanner(nextLevelNum);
    this.lastFrameAt = 0;
    this.startCountdown();
    this.trySpawnNextWord();

  }



  showLevelBanner(level: number) {

    this.levelBanner = level;

    setTimeout(() => { this.levelBanner = null; }, 1200);

  }



  endGame(result: 'complete' | 'gameover') {

    this.phase = result;

    if (this.raf) cancelAnimationFrame(this.raf);

    if (this.spawnTimer) clearInterval(this.spawnTimer);

    if (this.countdownTimer) clearInterval(this.countdownTimer);

    this.fallingWords = [];

    if (result === 'complete') {

      this.showConfetti = true;

      setTimeout(() => { this.showConfetti = false; }, 2500);

    }

  }



  showFeedback(state: 'correct' | 'wrong') {

    this.feedbackState = state;

    setTimeout(() => { this.feedbackState = null; }, 800);

  }



  buildResult(): SRResult {

    return {

      score: this.score,

      accuracy: this.accuracy,

      timeSpentSeconds: Math.round((Date.now() - this.startTime) / 1000),

      livesRemaining: this.lives,

      currentLevel: this.currentLevelNum,

    };

  }



  triggerConfetti() {

    if (this.phase === 'complete') {

      this.showConfetti = true;

      setTimeout(() => { this.showConfetti = false; }, 2000);

    }

  }



  onPause() {}



  @HostListener('document:keydown', ['$event'])

  onKey(e: KeyboardEvent) {

    if (this.phase !== 'playing') return;

    if (document.activeElement !== this.wordInputRef?.nativeElement) {

      if (e.key.length === 1 && e.key.match(/[a-zA-ZäöüÄÖÜß]/)) {

        this.focusInput();

      }

    }

  }

}
