import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { GameHudComponent } from '../../shared/game-hud/game-hud.component';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { GameAudioService } from '../../services/game-audio.service';
import {
  ArenaBattleRound, ArenaBattleGenderQuestion, ArenaBattleAnswerResult,
} from '../../glueck-arena.types';

@Component({
  selector: 'app-gender-stack-mp',
  standalone: true,
  imports: [CommonModule, MaterialModule, GameHudComponent, XpFloatComponent, ConfettiBurstComponent],
  template: `
    <div class="gsmp">
      <app-game-hud
        [score]="localScore"
        [current]="roundIndex + 1"
        [total]="totalRounds"
        [showLives]="false"
      ></app-game-hud>

      <div class="gsmp__board" *ngIf="question && !answered">
        <div class="gsmp__counter">Round {{ roundIndex + 1 }} / {{ totalRounds }}</div>
        <div class="gsmp__word">{{ question.word }}</div>
        <p class="gsmp__translation" *ngIf="question.translation">Translation: {{ question.translation }}</p>
        <p class="gsmp__question">Which article does this noun take?</p>
        <div class="gsmp__buckets">
          <button class="gsmp__bucket gsmp__bucket--der"
            [class.gsmp__bucket--selected]="selectedGender === 'der'"
            [class.gsmp__bucket--correct]="feedback === 'correct' && selectedGender === 'der'"
            [class.gsmp__bucket--wrong]="feedback === 'wrong' && selectedGender === 'der'"
            [disabled]="!!feedback" (click)="selectGender('der')">
            <span class="gsmp__article">DER</span>
            <span class="gsmp__hint">masculine</span>
          </button>
          <button class="gsmp__bucket gsmp__bucket--die"
            [class.gsmp__bucket--selected]="selectedGender === 'die'"
            [class.gsmp__bucket--correct]="feedback === 'correct' && selectedGender === 'die'"
            [class.gsmp__bucket--wrong]="feedback === 'wrong' && selectedGender === 'die'"
            [disabled]="!!feedback" (click)="selectGender('die')">
            <span class="gsmp__article">DIE</span>
            <span class="gsmp__hint">feminine</span>
          </button>
          <button class="gsmp__bucket gsmp__bucket--das"
            [class.gsmp__bucket--selected]="selectedGender === 'das'"
            [class.gsmp__bucket--correct]="feedback === 'correct' && selectedGender === 'das'"
            [class.gsmp__bucket--wrong]="feedback === 'wrong' && selectedGender === 'das'"
            [disabled]="!!feedback" (click)="selectGender('das')">
            <span class="gsmp__article">DAS</span>
            <span class="gsmp__hint">neuter</span>
          </button>
        </div>
        <div class="gsmp__submit-area" *ngIf="selectedGender && !feedback">
          <button mat-raised-button color="primary" (click)="submit()">
            <mat-icon>check</mat-icon> Confirm
          </button>
        </div>
        <div class="gsmp__feedback gsmp__feedback--correct" *ngIf="feedback === 'correct'">
          <mat-icon>check_circle</mat-icon> +{{ lastPoints }} pts
        </div>
        <div class="gsmp__feedback gsmp__feedback--wrong" *ngIf="feedback === 'wrong'">
          <mat-icon>cancel</mat-icon> {{ revealAnswer || 'Wrong' }}
        </div>
      </div>

      <div class="gsmp__waiting" *ngIf="answered">Waiting for next round…</div>
      <app-xp-float [xp]="lastPoints" [trigger]="xpTrigger"></app-xp-float>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .gsmp { position: relative; display: flex; flex-direction: column; gap: 12px; }
    .gsmp__board { text-align: center; background: linear-gradient(180deg, #f0fdf4, #ecfdf5); border-radius: 20px; padding: 32px 24px; border: 2px solid #bbf7d0; }
    .gsmp__counter { font-size: 13px; color: #888; font-weight: 600; margin-bottom: 8px; }
    .gsmp__word { font-size: 36px; font-weight: 800; color: #1e293b; margin: 16px 0; }
    .gsmp__translation { font-size: 14px; color: #64748b; margin-bottom: 8px; font-style: italic; }
    .gsmp__question { font-size: 15px; color: #475569; margin-bottom: 20px; font-weight: 600; }
    .gsmp__buckets { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
    .gsmp__bucket { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 20px 32px; border-radius: 16px; border: 3px solid transparent; cursor: pointer; transition: all .15s; min-width: 120px; color: #fff; font-weight: 700; }
    .gsmp__bucket:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.08); }
    .gsmp__bucket:disabled { opacity: 0.7; cursor: default; }
    .gsmp__bucket--der { background: linear-gradient(145deg, #ef4444, #dc2626); }
    .gsmp__bucket--die { background: linear-gradient(145deg, #22c55e, #16a34a); }
    .gsmp__bucket--das { background: linear-gradient(145deg, #3b82f6, #2563eb); }
    .gsmp__bucket--selected { transform: translateY(-2px); box-shadow: 0 0 0 4px rgba(255,255,255,0.6), 0 8px 24px rgba(0,0,0,0.15); }
    .gsmp__bucket--correct { filter: brightness(1.15) !important; box-shadow: 0 0 0 4px rgba(34,197,94,0.5) !important; }
    .gsmp__bucket--wrong { filter: brightness(0.7) !important; box-shadow: 0 0 0 4px rgba(239,68,68,0.5) !important; }
    .gsmp__article { font-size: 28px; font-weight: 900; letter-spacing: 0.05em; }
    .gsmp__hint { font-size: 12px; opacity: 0.85; font-weight: 500; }
    .gsmp__submit-area { margin-top: 16px; }
    .gsmp__feedback { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 12px; padding: 10px; border-radius: 10px; font-weight: 700; }
    .gsmp__feedback--correct { background: #e8f5e9; color: #2e7d32; }
    .gsmp__feedback--wrong { background: #fce4ec; color: #b71c1c; }
    .gsmp__waiting { text-align: center; color: #888; padding: 24px; font-style: italic; }
  `]
})
export class GenderStackMpComponent implements OnChanges {
  @Input() round: ArenaBattleRound | null = null;
  @Input() localScore = 0;
  @Input() answerResult: ArenaBattleAnswerResult | null = null;
  @Output() submitAnswer = new EventEmitter<{ typedWord: string }>();

  question: ArenaBattleGenderQuestion | null = null;
  roundIndex = 0;
  totalRounds = 10;
  selectedGender: string | null = null;
  feedback: 'correct' | 'wrong' | null = null;
  answered = false;
  lastPoints = 0;
  revealAnswer = '';
  xpTrigger = 0;
  showConfetti = false;

  constructor(readonly audio: GameAudioService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['round'] && this.round) this.loadRound(this.round);
    if (changes['answerResult'] && this.answerResult) this.applyResult(this.answerResult);
  }

  loadRound(round: ArenaBattleRound) {
    this.question = round.question as ArenaBattleGenderQuestion;
    this.roundIndex = round.roundIndex;
    this.totalRounds = round.totalRounds;
    this.selectedGender = null;
    this.feedback = null;
    this.answered = false;
    this.revealAnswer = '';
  }

  selectGender(gender: string) {
    if (this.feedback) return;
    this.selectedGender = gender;
  }

  submit() {
    if (!this.selectedGender || this.feedback || this.answered) return;
    this.answered = true;
    this.submitAnswer.emit({ typedWord: this.selectedGender });
  }

  applyResult(r: ArenaBattleAnswerResult) {
    this.feedback = r.isCorrect ? 'correct' : 'wrong';
    this.lastPoints = r.points;
    this.revealAnswer = r.correctAnswer?.word || '';
    if (r.isCorrect) {
      this.audio.playCorrect();
      this.xpTrigger++;
      this.audio.playXpGain();
      this.showConfetti = true;
      setTimeout(() => this.showConfetti = false, 1500);
    } else {
      this.audio.playWrong();
    }
  }
}
