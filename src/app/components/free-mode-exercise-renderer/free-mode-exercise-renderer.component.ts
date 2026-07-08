import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DigitalExerciseService, DigitalExercise, ExerciseQuestion, SubmitResult } from '../../services/digital-exercise.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../../shared/material.module';
import { resolveMediaUrl } from '../../utils/media-url';

type RenderItemKind = 'content-block' | 'question';

interface RenderItem {
  kind: RenderItemKind;
  sectionTitle?: string;
  context?: string;
  instruction?: string;
  example?: string;
  attachmentUrls?: string[];
  questionIndex?: number;
  question?: any;
  /** Per-attempt audio play cap from the following question, or null if unlimited. */
  attachmentAudioCap?: number | null;
}

interface AnswerState {
  selectedOptionIndex?: number;
  matchingResponse?: Array<{ leftIndex: number; rightIndex: number; rightValue?: string | null }>;
  fillBlankResponses?: string[];
  wordBankAnswers?: Array<{ index: number; value: string }>;
  singularPluralResponses?: string[];
  qaResponse?: string;
  listeningText?: string;
  jumbleWordResponse?: string;
  usedJumbleIndices?: number[];
  usedRearrangeIndices?: number[];
  rearrangeTextResponse?: string;
  rearrangeTokensResponse?: string[];
  imagePinAnswers?: Array<{ labelId: string; pinId: string }>;
}

type PlayerState = 'loading' | 'playing' | 'submitting' | 'submitted' | 'error';

@Component({
  selector: 'app-free-mode-exercise-renderer',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  template: `
<div class="fmr-container">
  <!-- Loading -->
  <div class="fmr-loading" *ngIf="state === 'loading'">
    <div class="spinner"></div>
    <p>Loading exercise...</p>
  </div>

  <!-- Error -->
  <div class="fmr-error" *ngIf="state === 'error'">
    <span class="material-icons error-icon">error_outline</span>
    <h3>Something went wrong</h3>
    <p>{{ errorMessage }}</p>
    <button class="btn-back" (click)="goBack()">Go Back</button>
  </div>

  <!-- Playing -->
  <div class="fmr-scroll" *ngIf="state === 'playing'">
    <!-- Header -->
    <div class="fmr-header">
      <button class="fmr-back-btn" (click)="goBack()">
        <span class="material-icons">arrow_back</span>
      </button>
      <div class="fmr-header-info">
        <h1>{{ exercise?.title }}</h1>
        <p class="fmr-meta">{{ exercise?.level }} · {{ exercise?.category }} · {{ exercise?.difficulty }}</p>
        <p class="fmr-desc">{{ exercise?.description }}</p>
      </div>
      <div class="fmr-progress" *ngIf="totalQuestions > 0">
        <span>{{ answeredCount }} / {{ totalQuestions }} answered</span>
      </div>
    </div>

    <!-- Render List -->
    <ng-container *ngFor="let item of renderList; let idx = index">
      <!-- Content Block -->
      <div class="content-block" *ngIf="item.kind === 'content-block'">
        <h2 class="content-section-title" *ngIf="item.sectionTitle">{{ item.sectionTitle }}</h2>
        <p class="content-context" *ngIf="item.context">{{ item.context }}</p>
        <div class="content-instruction" *ngIf="item.instruction">
          <span class="material-icons">info</span> {{ item.instruction }}
        </div>
        <div class="content-example" *ngIf="item.example">
          <span class="example-label">Example:</span> {{ item.example }}
        </div>
        <div class="content-attachments" *ngIf="item.attachmentUrls?.length">
          <div *ngFor="let url of item.attachmentUrls" class="attachment-item">
            <ng-container [ngSwitch]="getAttachmentType(url)">
              <img *ngSwitchCase="'image'" [src]="resolveUrl(url)" class="att-img" (click)="openFullscreen($event)" />
              <ng-container *ngSwitchCase="'audio'">
                <ng-container *ngIf="item.attachmentAudioCap != null; else unlimitedAudio">
                  <p *ngIf="getContentAudioPlaysRemaining(idx, url)! > 0" class="att-audio-remaining">
                    You can start this audio
                    <strong>{{ getContentAudioPlaysRemaining(idx, url)! }}</strong>
                    more time<span *ngIf="getContentAudioPlaysRemaining(idx, url)! !== 1">s</span>
                    this attempt (each press of Play counts).
                  </p>
                  <span *ngIf="getContentAudioPlaysRemaining(idx, url)! === 0" class="cap-reached">
                    <span class="material-icons">volume_off</span> Play limit reached for this attempt.
                  </span>
                  <audio *ngIf="getContentAudioPlaysRemaining(idx, url)! > 0"
                         [src]="resolveUrl(url)" controls class="att-audio"
                         (play)="onContentAudioPlay(idx, url, $any($event.target))">
                  </audio>
                </ng-container>
                <ng-template #unlimitedAudio>
                  <audio [src]="resolveUrl(url)" controls class="att-audio"></audio>
                </ng-template>
              </ng-container>
              <video *ngSwitchCase="'video'" [src]="resolveUrl(url)" controls class="att-video"></video>
              <a *ngSwitchDefault [href]="resolveUrl(url)" target="_blank" class="att-link">
                <span class="material-icons">attachment</span> View attachment
              </a>
            </ng-container>
          </div>
        </div>
      </div>

      <!-- Question -->
      <div class="question-card" *ngIf="item.kind === 'question'" [class.has-error]="!!questionErrors[item.questionIndex!]">
        <div class="q-header">
          <span class="q-number">{{ item.questionIndex! + 1 }}</span>
          <span class="q-type-badge">{{ getTypeLabel(item.question!) }}</span>
          <span class="q-points" *ngIf="item.question!.points">{{ item.question!.points }} pt</span>
        </div>

        <div class="q-body">
          <ng-container [ngSwitch]="item.question!.type">
            <!-- MCQ -->
            <ng-container *ngSwitchCase="'mcq'">
            <div class="mcq-options" *ngIf="item.question!.options?.length" [class.mcq-options--visual]="hasMcqOptionImages(item.question!)">
              <p class="q-text">{{ item.question!.question }}</p>
              <div *ngFor="let opt of item.question!.options; let oi = index" class="mcq-option"
                [class.selected]="getAnswer(item.questionIndex!).selectedOptionIndex === oi"
                [class.mcq-option--visual]="hasMcqOptionImages(item.question!)"
                (click)="setMcqAnswer(item.questionIndex!, oi)">
                <img *ngIf="getMcqOptionImageUrl(item.question!, oi) as optImg" [src]="resolveUrl(optImg)" alt="" class="mcq-option-img" />
                <span class="option-letter">{{ hasMcqOptionImages(item.question!) ? 'abcd'[oi] : 'ABCDEFGHIJ'[oi] }}</span>
                <span class="option-text">{{ opt }}</span>
                <span class="material-icons check-icon">check_circle</span>
              </div>
            </div>
            </ng-container>

            <!-- Matching -->
            <div *ngSwitchCase="'matching'">
              <p class="q-text" *ngIf="item.question!.instruction">{{ item.question!.instruction }}</p>
              <div *ngFor="let pair of item.question!.pairs; let pi = index" class="match-row">
                <span class="match-left">{{ pair.left }}</span>
                <span class="match-arrow">→</span>
                <select class="match-select"
                  [ngModel]="getMatchAnswer(item.questionIndex!, pi)"
                  (ngModelChange)="setMatchAnswer(item.questionIndex!, pi, $event)">
                  <option value="" disabled>Select match</option>
                  <option *ngFor="let r of getShuffledRights(item.question!)" [value]="r">{{ r }}</option>
                </select>
              </div>
            </div>

            <!-- Fill Blank -->
            <div *ngSwitchCase="'fill-blank'">
              <p class="q-text">{{ formatFillBlankSentence(item.question!) }}</p>
              <div class="fill-blanks">
                <div *ngFor="let blank of getFillBlankSlots(item.question!); let bi = index" class="fill-row">
                  <span class="blank-label">{{ bi + 1 }}.</span>
                  <input type="text" class="blank-input"
                    [ngModel]="getFillBlankAnswer(item.questionIndex!, bi)"
                    (ngModelChange)="setFillBlankAnswer(item.questionIndex!, bi, $event)"
                    [placeholder]="'Blank ' + (bi + 1)" />
                </div>
              </div>
              <p class="hint-text" *ngIf="item.question!.hint">{{ item.question!.hint }}</p>
            </div>

            <!-- Word Bank Fill -->
            <div *ngSwitchCase="'word_bank_fill'">
              <div class="word-bank">
                <span class="wb-label">Word Bank:</span>
                <span *ngFor="let w of item.question!.wordBank" class="wb-chip"
                  [class.used]="isWordBankWordUsed(item.questionIndex!, w)"
                  (click)="fillWordBankAnswer(item.questionIndex!, w)">
                  {{ w }}
                </span>
              </div>
              <div *ngFor="let wbi of item.question!.items; let wii = index" class="wb-item-row">
                <span class="wb-prompt">{{ wbi.prompt }}</span>
                <span class="wb-arrow">→</span>
                <input type="text" class="wb-input"
                  [ngModel]="getWordBankAnswer(item.questionIndex!, wii)"
                  (ngModelChange)="setWordBankAnswer(item.questionIndex!, wii, $event)"
                  placeholder="Type or click a word" />
              </div>
            </div>

            <!-- Singular / Plural -->
            <div *ngSwitchCase="'singular_plural'">
              <p class="q-text" *ngIf="item.question!.instruction">{{ item.question!.instruction }}</p>
              <div *ngFor="let pair of item.question!.pairs; let pi = index" class="sp-row">
                <span class="sp-singular">{{ pair.singular }}</span>
                <span class="sp-arrow">→</span>
                <input type="text" class="sp-input"
                  [ngModel]="getSingularPluralAnswer(item.questionIndex!, pi)"
                  (ngModelChange)="setSingularPluralAnswer(item.questionIndex!, pi, $event)"
                  placeholder="Plural form" />
              </div>
            </div>

            <!-- Question / Answer -->
            <div *ngSwitchCase="'question-answer'">
              <p class="q-text">{{ item.question!.prompt }}</p>
              <p class="q-story" *ngIf="item.question!.storyParagraph">{{ item.question!.storyParagraph }}</p>
              <textarea class="qa-textarea"
                [ngModel]="getAnswer(item.questionIndex!).qaResponse"
                (ngModelChange)="setQaAnswer(item.questionIndex!, $event)"
                rows="3" placeholder="Type your answer..."></textarea>
            </div>

            <!-- Listening -->
            <div *ngSwitchCase="'listening'">
              <div class="listening-player" *ngIf="item.question!.mediaUrl">
                <audio [src]="resolveUrl(item.question!.mediaUrl)" controls class="listening-audio"></audio>
              </div>
              <textarea class="qa-textarea"
                [ngModel]="getAnswer(item.questionIndex!).listeningText"
                (ngModelChange)="setListeningAnswer(item.questionIndex!, $event)"
                rows="2" placeholder="Type what you hear..."></textarea>
            </div>

            <!-- Jumble Word -->
            <div *ngSwitchCase="'jumble-word'">
              <div class="jumble-display">
                <span *ngFor="let ch of getJumbleChars(item.questionIndex!); let ci = index" class="jumble-char"
                  [class.bold]="ch.bold" [class.disabled]="ch.disabled"
                  (click)="!ch.disabled && appendJumbleChar(item.questionIndex!, ci)">{{ ch.char }}</span>
              </div>
              <p class="hint-text" *ngIf="item.question!.categoryTip">{{ item.question!.categoryTip }}</p>
              <input type="text" class="jumble-input"
                [ngModel]="getAnswer(item.questionIndex!).jumbleWordResponse"
                (ngModelChange)="setJumbleWordAnswer(item.questionIndex!, $event)"
                placeholder="Type the correct word" />
            </div>

            <!-- Rearrange -->
            <div *ngSwitchCase="'rearrange'">
              <p class="q-text" *ngIf="item.question!.rearrangePrompt">{{ item.question!.rearrangePrompt }}</p>
              <div class="jumble-display">
                <span *ngFor="let tok of getShuffledTokens(item.question!); let ti = index" class="wb-chip"
                  [class.disabled]="isRearrangeUsed(item.questionIndex!, ti)"
                  (click)="!isRearrangeUsed(item.questionIndex!, ti) && appendRearrangeToken(item.questionIndex!, ti)">{{ tok }}</span>
              </div>
              <input type="text" class="jumble-input"
                [ngModel]="getAnswer(item.questionIndex!).rearrangeTextResponse"
                (ngModelChange)="setRearrangeTextAnswer(item.questionIndex!, $event)"
                placeholder="Type the sentence in order" />
            </div>

            <!-- Image Pin Match -->
            <div *ngSwitchCase="'image_pin_match'">
              <div class="pin-container" *ngIf="item.question!.imageUrl">
                <div class="pin-image-wrapper">
                  <img [src]="resolveUrl(item.question!.imageUrl)" class="pin-image"
                    (click)="onPinImageClick($event, item.questionIndex!)" />
                  <div *ngFor="let pin of item.question!.pins"
                    class="pin-dot"
                    [class.active]="isPinSelected(item.questionIndex!, pin.id)"
                    [style.left.%]="pin.x"
                    [style.top.%]="pin.y"
                    (click)="selectPin(item.questionIndex!, pin.id)">
                    <span class="pin-label">{{ pin.id }}</span>
                  </div>
                </div>
              </div>
              <div class="pin-labels">
                <div *ngFor="let lbl of item.question!.labels" class="pin-label-row"
                  [class.answered]="getPinLabelAnswer(item.questionIndex!, lbl.id)">
                  <span class="pin-label-text">{{ lbl.text }}</span>
                  <span class="pin-label-arrow">→</span>
                  <span class="pin-label-pin">{{ getPinLabelAnswer(item.questionIndex!, lbl.id) || '—' }}</span>
                </div>
              </div>
            </div>

            <!-- Default / unsupported -->
            <div *ngSwitchDefault>
              <p class="unsupported-type">Question type "{{ item.question!.type }}" not supported in free mode.</p>
            </div>
          </ng-container>
        </div>

        <div class="q-error" *ngIf="questionErrors[item.questionIndex!]">
          {{ questionErrors[item.questionIndex!] }}
        </div>
      </div>
    </ng-container>

    <!-- Submit -->
    <div class="fmr-submit-bar" *ngIf="renderList.length > 0">
      <button class="btn-submit" (click)="submit()" [disabled]="submitting">
        <span class="material-icons">{{ submitting ? 'hourglass_top' : 'check_circle' }}</span>
        {{ submitting ? 'Submitting...' : 'Submit Answers' }}
      </button>
    </div>
  </div>

  <!-- Submitted -->
  <div class="fmr-result" *ngIf="state === 'submitted'">
    <div class="result-card" [class.passed]="submitResult?.passed" [class.failed]="!submitResult?.passed">
      <span class="material-icons result-icon">{{ submitResult?.passed ? 'celebration' : 'sentiment_dissatisfied' }}</span>
      <h2>{{ submitResult?.passed ? 'Great job!' : 'Keep practicing!' }}</h2>
      <div class="result-score">
        <span class="score-pct">{{ submitResult?.scorePercentage }}%</span>
        <span class="score-detail">{{ submitResult?.earnedPoints }} / {{ submitResult?.totalPoints }} points</span>
      </div>
      <div class="result-actions">
        <button class="btn-review" (click)="goToReview()">
          <span class="material-icons">rate_review</span> View Review
        </button>
        <button class="btn-retry" (click)="retry()">
          <span class="material-icons">replay</span> Try Again
        </button>
      </div>
    </div>
  </div>
</div>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }

    .fmr-container {
      max-width: 860px;
      margin: 0 auto;
      padding: 20px 16px 40px;
    }

    /* Loading */
    .fmr-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 60vh;
      color: #0369a1;
    }

    .spinner {
      width: 36px;
      height: 36px;
      border: 3px solid #38bdf8;
      border-top-color: #0369a1;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      margin-bottom: 12px;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    /* Error */
    .fmr-error {
      text-align: center;
      padding: 60px 20px;
    }

    .error-icon { font-size: 48px; color: #ef4444; margin-bottom: 12px; }
    .fmr-error h3 { margin: 0 0 6px; color: #1e293b; }
    .fmr-error p { color: #64748b; font-size: 13px; margin: 0 0 20px; }

    .btn-back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      color: #475569;
    }

    .btn-back:hover { background: #f1f5f9; }

    /* Scroll area */
    .fmr-scroll {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    /* Header */
    .fmr-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      background: linear-gradient(135deg, #0369a1, #0ea5e9);
      color: #fff;
      border-radius: 14px;
      padding: 20px;
    }

    .fmr-back-btn {
      background: rgba(255,255,255,0.15);
      border: none;
      border-radius: 8px;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #fff;
      flex-shrink: 0;
    }

    .fmr-back-btn:hover { background: rgba(255,255,255,0.25); }
    .fmr-back-btn .material-icons { font-size: 20px; }

    .fmr-header-info { flex: 1; }
    .fmr-header-info h1 { margin: 0 0 4px; font-size: 18px; font-weight: 700; }
    .fmr-meta { margin: 0 0 2px; font-size: 11px; opacity: 0.8; }
    .fmr-desc { margin: 0; font-size: 12px; opacity: 0.7; }

    .fmr-progress {
      background: rgba(255,255,255,0.15);
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }

    /* Content Block */
    .content-block {
      background: #fff;
      border: 1px solid #38bdf8;
      border-radius: 12px;
      padding: 16px 20px;
    }

    .content-section-title {
      margin: 0 0 8px;
      font-size: 16px;
      font-weight: 700;
      color: #0369a1;
    }

    .content-context {
      margin: 0 0 8px;
      font-size: 13px;
      color: #334155;
      line-height: 1.5;
    }

    .content-instruction {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      background: #e0f2fe;
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 12px;
      color: #0369a1;
      margin-bottom: 6px;
    }

    .content-instruction .material-icons { font-size: 16px; }

    .content-example {
      background: #e0f2fe;
      border: 1px dashed #7dd3fc;
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 12px;
      color: #0369a1;
      margin-bottom: 6px;
    }

    .example-label { font-weight: 600; }

    .content-attachments { display: flex; gap: 8px; margin-top: 6px; overflow-x: auto; flex-shrink: 0; }
    .att-img { max-height: 480px; border-radius: 8px; border: 1px solid #e2e8f0; cursor: pointer; }
    .att-audio { height: 36px; max-width: 100%; }
    .cap-reached {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: #94a3b8;
    }
    .cap-reached .material-icons { font-size: 16px; }
    .att-video { max-height: 200px; max-width: 100%; border-radius: 8px; }
    .att-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 6px 12px;
      background: #f1f5f9;
      border-radius: 6px;
      font-size: 12px;
      color: #475569;
      text-decoration: none;
    }

    /* Question Card */
    .question-card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
    }

    .question-card.has-error { border-color: #fca5a5; }

    .q-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
    }

    .q-number {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #0369a1;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
    }

    .q-type-badge {
      font-size: 10px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .q-points {
      margin-left: auto;
      font-size: 10px;
      font-weight: 600;
      color: #94a3b8;
    }

    .q-body {
      padding: 14px 16px;
    }

    .q-text {
      margin: 0 0 10px;
      font-size: 13px;
      color: #1e293b;
      line-height: 1.5;
      font-weight: 500;
    }

    .q-story {
      margin: 0 0 10px;
      font-size: 12px;
      color: #475569;
      line-height: 1.6;
      background: #f8fafc;
      padding: 10px;
      border-radius: 8px;
      border-left: 3px solid #0369a1;
    }

    .q-error {
      padding: 6px 16px 10px;
      font-size: 11px;
      color: #ef4444;
    }

    /* MCQ */
    .mcq-options { display: flex; flex-direction: column; gap: 6px; }
    .mcq-options--visual { gap: 10px; }

    .mcq-option {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border: 1.5px solid #e2e8f0;
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .mcq-option--visual {
      flex-wrap: wrap;
      align-items: flex-start;
    }

    .mcq-option:hover { border-color: #7dd3fc; background: #bae6fd; }
    .mcq-option.selected { border-color: #0369a1; background: #bae6fd; }
    .mcq-option-img {
      width: 72px;
      height: 72px;
      object-fit: cover;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      flex-shrink: 0;
    }

    .option-letter {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: #f1f5f9;
      font-size: 12px;
      font-weight: 700;
      color: #475569;
      flex-shrink: 0;
    }

    .selected .option-letter { background: #0369a1; color: #fff; }
    .option-text { flex: 1; font-size: 13px; color: #334155; }

    .check-icon {
      font-size: 20px;
      color: transparent;
      transition: color 0.15s;
    }

    .selected .check-icon { color: #0369a1; }

    /* Matching */
    .match-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .match-left {
      flex: 1;
      font-size: 13px;
      font-weight: 500;
      color: #334155;
      padding: 6px 10px;
      background: #f8fafc;
      border-radius: 6px;
    }

    .match-arrow { color: #94a3b8; font-size: 14px; }
    .match-select {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 12px;
      font-family: inherit;
      background: #fff;
    }

    /* Fill Blank */
    .fill-blanks { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
    .fill-row { display: flex; align-items: center; gap: 8px; }
    .blank-label { font-size: 12px; font-weight: 600; color: #0369a1; min-width: 20px; }
    .blank-input {
      flex: 1;
      padding: 8px 12px;
      border: 1.5px solid #e2e8f0;
      border-radius: 8px;
      font-size: 13px;
      font-family: inherit;
    }
    .blank-input:focus { border-color: #0369a1; outline: none; box-shadow: 0 0 0 2px rgba(2,132,199,0.12); }
    .hint-text { margin: 4px 0 0; font-size: 11px; color: #94a3b8; font-style: italic; }

    /* Word Bank */
    .word-bank {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-bottom: 12px;
      padding: 10px 12px;
      background: #e0f2fe;
      border: 1px solid #7dd3fc;
      border-radius: 8px;
    }

    .wb-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #0369a1; margin-right: 4px; }

    .wb-chip {
      display: inline-block;
      padding: 3px 10px;
      background: #fff;
      border: 1px solid #38bdf8;
      border-radius: 999px;
      font-size: 12px;
      color: #0369a1;
      cursor: pointer;
      transition: all 0.15s;
    }

    .wb-chip:hover { background: #bae6fd; }
    .wb-chip.used { opacity: 0.35; text-decoration: line-through; cursor: default; }
    .wb-chip.disabled { opacity: 0.25; cursor: default; pointer-events: none; }

    .wb-item-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }

    .wb-prompt { flex: 1; font-size: 13px; color: #334155; padding: 6px 10px; background: #f8fafc; border-radius: 6px; }
    .wb-arrow { color: #94a3b8; }
    .wb-input {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 12px;
      font-family: inherit;
    }

    /* Singular Plural */
    .sp-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .sp-singular {
      flex: 1;
      font-size: 13px;
      font-weight: 500;
      color: #334155;
      padding: 6px 10px;
      background: #f8fafc;
      border-radius: 6px;
    }

    .sp-arrow { color: #94a3b8; }
    .sp-input {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 12px;
      font-family: inherit;
    }

    /* QA / Listening textarea */
    .qa-textarea {
      width: 100%;
      padding: 10px 12px;
      border: 1.5px solid #e2e8f0;
      border-radius: 8px;
      font-size: 13px;
      font-family: inherit;
      resize: vertical;
      box-sizing: border-box;
    }
    .qa-textarea:focus { border-color: #0369a1; outline: none; box-shadow: 0 0 0 2px rgba(2,132,199,0.12); }

    /* Listening */
    .listening-player { margin-bottom: 10px; }
    .listening-audio { width: 100%; height: 40px; }

    /* Jumble Word */
    .jumble-display {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 12px;
      padding: 12px 16px;
      background: #e0f2fe;
      border: 1px solid #7dd3fc;
      border-radius: 10px;
      justify-content: center;
    }

    .jumble-char {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 36px;
      background: #fff;
      border: 1.5px solid #38bdf8;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 700;
      color: #0369a1;
      font-family: monospace;
    }

    .jumble-char.bold { background: #0369a1; color: #fff; border-color: #0369a1; }
    .jumble-char.disabled { opacity: 0.25; cursor: default; pointer-events: none; }

    .jumble-input {
      width: 100%;
      padding: 8px 12px;
      border: 1.5px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      text-align: center;
      letter-spacing: 2px;
      box-sizing: border-box;
    }
    .jumble-input:focus { border-color: #0369a1; outline: none; }

    /* Rearrange */


    /* Image Pin Match */
    .pin-container { position: relative; margin-bottom: 12px; }
    .pin-image-wrapper { position: relative; display: inline-block; max-width: 100%; }
    .pin-image { max-width: 100%; border-radius: 8px; border: 1px solid #e2e8f0; cursor: crosshair; }
    .pin-dot {
      position: absolute;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(2,132,199,0.6);
      border: 2px solid #0369a1;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: translate(-50%, -50%);
      cursor: pointer;
      transition: all 0.15s;
    }
    .pin-dot.active { background: #0369a1; border-color: #fff; box-shadow: 0 0 0 3px rgba(2,132,199,0.3); }
    .pin-label { font-size: 9px; font-weight: 700; color: #fff; }

    .pin-labels { display: flex; flex-direction: column; gap: 6px; }
    .pin-label-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background: #f8fafc;
      border-radius: 6px;
      font-size: 12px;
    }
    .pin-label-row.answered { background: #bae6fd; }
    .pin-label-text { flex: 1; font-weight: 500; color: #334155; }
    .pin-label-arrow { color: #94a3b8; }
    .pin-label-pin { font-weight: 600; color: #0369a1; min-width: 24px; text-align: center; }

    .unsupported-type { color: #94a3b8; font-size: 12px; font-style: italic; }

    /* Submit Bar */
    .fmr-submit-bar {
      display: flex;
      justify-content: center;
      padding: 16px 0 8px;
    }

    .btn-submit {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: linear-gradient(135deg, #0369a1, #0ea5e9);
      color: #fff;
      border: none;
      border-radius: 12px;
      padding: 12px 32px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
    }

    .btn-submit:hover:not(:disabled) { background: linear-gradient(135deg, #0369a1, #0369a1); transform: translateY(-1px); box-shadow: 0 4px 16px rgba(2,132,199,0.3); }
    .btn-submit:disabled { opacity: 0.5; cursor: default; }

    /* Result */
    .fmr-result {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 70vh;
    }

    .result-card {
      text-align: center;
      background: #fff;
      border-radius: 20px;
      padding: 40px 48px;
      box-shadow: 0 8px 32px rgba(15,23,42,0.1);
      max-width: 400px;
    }

    .result-card.passed { border: 2px solid #86efac; }
    .result-card.failed { border: 2px solid #fca5a5; }

    .result-icon { font-size: 56px; }
    .passed .result-icon { color: #22c55e; }
    .failed .result-icon { color: #ef4444; }

    .result-card h2 { margin: 12px 0 8px; font-size: 20px; color: #1e293b; }

    .result-score { margin-bottom: 20px; }
    .score-pct { display: block; font-size: 42px; font-weight: 800; color: #0369a1; line-height: 1; }
    .score-detail { display: block; font-size: 13px; color: #64748b; margin-top: 4px; }

    .result-actions { display: flex; gap: 10px; justify-content: center; }

    .btn-review, .btn-retry {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 20px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
    }

    .btn-review {
      background: #0369a1;
      color: #fff;
      border: none;
    }

    .btn-review:hover { background: #0369a1; }

    .btn-retry {
      background: #fff;
      color: #64748b;
      border: 1px solid #e2e8f0;
    }

    .btn-retry:hover { border-color: #0369a1; color: #0369a1; }

    /* Responsive */
    @media (max-width: 600px) {
      .fmr-container { padding: 12px 10px 32px; }
      .fmr-header { flex-direction: column; padding: 16px; }
      .fmr-header-info h1 { font-size: 16px; }
      .result-card { padding: 28px 20px; }
      .score-pct { font-size: 32px; }
    }

    @media (max-width: 762px) {
      .att-img { width: 100%; }
    }
  `]
})
export class FreeModeExerciseRendererComponent implements OnInit {
  state: PlayerState = 'loading';
  exercise: DigitalExercise | null = null;
  renderList: RenderItem[] = [];
  answers: { [questionIndex: number]: AnswerState } = {};
  questionErrors: { [questionIndex: number]: string } = {};
  errorMessage = '';
  submitting = false;
  submitResult: SubmitResult | null = null;

  totalQuestions = 0;
  answeredCount = 0;

  private exerciseId = '';
  private attemptId = '';
  private attemptNumber = 0;
  private startTime = 0;
  private attachmentAudioPlaysUsed: Record<string, number> = {};
  private currentAudio: HTMLAudioElement | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private exerciseService: DigitalExerciseService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.exerciseId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.exerciseId) {
      this.setError('Exercise ID not found');
      return;
    }
    this.loadExercise();
  }

  private loadExercise(): void {
    this.state = 'loading';
    const opts = { asStudent: this.route.snapshot.queryParamMap.get('asStudent') === 'true' };
    this.exerciseService.getExercise(this.exerciseId, opts).subscribe({
      next: (ex) => {
        this.exercise = ex;
        this.buildRenderList(ex);
        this.initAnswers(ex);
        this.totalQuestions = (ex.questions || []).length;
        this.startTime = Date.now();
        this.state = 'playing';
      },
      error: (err) => {
        this.setError(err?.error?.error || err?.message || 'Failed to load exercise');
      }
    });
  }

  private buildRenderList(ex: DigitalExercise): void {
    const questions = ex.questions || [];
    const list: RenderItem[] = [];

    let lastSectionTitle: string | undefined;
    let lastContext: string | undefined;
    let lastInstruction: string | undefined;
    let lastAttachmentUrlsKey: string | undefined;

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const sectionTitle = q.sectionTitle || undefined;
      const context = q.context || undefined;
      const instruction = q.instruction || undefined;
      const example = q.example || undefined;
      const attachmentUrls = q.attachmentUrls?.length ? q.attachmentUrls : undefined;
      const attachmentUrlsKey = attachmentUrls?.join(',') || '';

      const sectionChanged = sectionTitle !== lastSectionTitle;
      const contextChanged = context !== lastContext;
      const instructionChanged = instruction !== lastInstruction;
      const attachmentsChanged = sectionChanged || contextChanged || instructionChanged || attachmentUrlsKey !== lastAttachmentUrlsKey;

      if (attachmentsChanged) {
        if (sectionTitle || context || instruction || (attachmentUrls?.length ?? 0) > 0) {
          const cb: RenderItem = {
            kind: 'content-block',
            sectionTitle: sectionChanged ? sectionTitle : undefined,
            context: contextChanged ? context : undefined,
            instruction: instructionChanged ? instruction : undefined,
            example,
            attachmentUrls
          };
          const cap = this.getAttachmentAudioCap(q);
          if (cap != null) {
            cb.attachmentAudioCap = cap;
          }
          list.push(cb);
        }
      }

      list.push({
        kind: 'question',
        questionIndex: i,
        question: q
      });

      lastSectionTitle = sectionTitle;
      lastContext = context;
      lastInstruction = instruction;
      lastAttachmentUrlsKey = attachmentUrlsKey;
    }

    // Append trailing content blocks (content blocks after the last question)
    if (ex.trailingContentBlocks?.length) {
      for (const block of ex.trailingContentBlocks) {
        list.push({
          kind: 'content-block',
          sectionTitle: block.sectionTitle || undefined,
          context: block.context || undefined,
          instruction: block.instruction || undefined,
          example: block.example || undefined,
          attachmentUrls: block.attachmentUrls?.length ? block.attachmentUrls : undefined,
        });
      }
    }

    this.renderList = list;
  }

  private initAnswers(ex: DigitalExercise): void {
    this.attachmentAudioPlaysUsed = {};
    const questions = ex.questions || [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const ans: AnswerState = {};
      if (q.type === 'fill-blank') {
        ans.fillBlankResponses = new Array(this.getFillBlankSlots(q).length).fill('');
      }
      if (q.type === 'matching') {
        ans.matchingResponse = [];
      }
      if (q.type === 'word_bank_fill') {
        ans.wordBankAnswers = [];
      }
      if (q.type === 'singular_plural') {
        ans.singularPluralResponses = new Array((q.pairs || []).length).fill('');
      }
      if (q.type === 'image_pin_match') {
        ans.imagePinAnswers = [];
      }
      this.answers[i] = ans;
    }
  }

  getAnswer(qIdx: number): AnswerState {
    return this.answers[qIdx] || (this.answers[qIdx] = {});
  }

  setMcqAnswer(qIdx: number, optionIndex: number): void {
    const ans = this.getAnswer(qIdx);
    ans.selectedOptionIndex = ans.selectedOptionIndex === optionIndex ? undefined : optionIndex;
    this.updateAnsweredCount();
  }

  getMatchAnswer(qIdx: number, pairIndex: number): string {
    const ans = this.getAnswer(qIdx);
    const mr = ans.matchingResponse || [];
    const found = mr.find(m => m.leftIndex === pairIndex);
    return found?.rightValue || '';
  }

  setMatchAnswer(qIdx: number, pairIndex: number, rightValue: string): void {
    const ans = this.getAnswer(qIdx);
    if (!ans.matchingResponse) ans.matchingResponse = [];
    const existing = ans.matchingResponse.find(m => m.leftIndex === pairIndex);
    if (existing) {
      existing.rightValue = rightValue || null;
    } else {
      ans.matchingResponse.push({ leftIndex: pairIndex, rightIndex: pairIndex, rightValue: rightValue || null });
    }
    this.updateAnsweredCount();
  }

  getFillBlankAnswer(qIdx: number, blankIndex: number): string {
    const ans = this.getAnswer(qIdx);
    return ans.fillBlankResponses?.[blankIndex] || '';
  }

  setFillBlankAnswer(qIdx: number, blankIndex: number, value: string): void {
    const ans = this.getAnswer(qIdx);
    if (!ans.fillBlankResponses) ans.fillBlankResponses = [];
    ans.fillBlankResponses[blankIndex] = value;
    this.updateAnsweredCount();
  }

  getWordBankAnswer(qIdx: number, itemIndex: number): string {
    const ans = this.getAnswer(qIdx);
    const found = (ans.wordBankAnswers || []).find(w => w.index === itemIndex);
    return found?.value || '';
  }

  setWordBankAnswer(qIdx: number, itemIndex: number, value: string): void {
    const ans = this.getAnswer(qIdx);
    if (!ans.wordBankAnswers) ans.wordBankAnswers = [];
    const existing = ans.wordBankAnswers.find(w => w.index === itemIndex);
    if (existing) {
      existing.value = value;
    } else {
      ans.wordBankAnswers.push({ index: itemIndex, value });
    }
    this.updateAnsweredCount();
  }

  isWordBankWordUsed(qIdx: number, word: string): boolean {
    const ans = this.getAnswer(qIdx);
    return (ans.wordBankAnswers || []).some(w => w.value === word);
  }

  fillWordBankAnswer(qIdx: number, word: string): void {
    if (this.isWordBankWordUsed(qIdx, word)) return;
    const ans = this.getAnswer(qIdx);
    const q = this.exercise?.questions?.[qIdx] as any;
    const items = q?.items || [];
    const firstEmpty = items.findIndex((_: any, idx: number) => {
      const found = (ans.wordBankAnswers || []).find(w => w.index === idx);
      return !found || !found.value;
    });
    if (firstEmpty >= 0) {
      this.setWordBankAnswer(qIdx, firstEmpty, word);
    }
  }

  getSingularPluralAnswer(qIdx: number, pairIndex: number): string {
    const ans = this.getAnswer(qIdx);
    return ans.singularPluralResponses?.[pairIndex] || '';
  }

  setSingularPluralAnswer(qIdx: number, pairIndex: number, value: string): void {
    const ans = this.getAnswer(qIdx);
    if (!ans.singularPluralResponses) ans.singularPluralResponses = [];
    ans.singularPluralResponses[pairIndex] = value;
    this.updateAnsweredCount();
  }

  setQaAnswer(qIdx: number, value: string): void {
    this.getAnswer(qIdx).qaResponse = value;
    this.updateAnsweredCount();
  }

  setListeningAnswer(qIdx: number, value: string): void {
    this.getAnswer(qIdx).listeningText = value;
    this.updateAnsweredCount();
  }

  setJumbleWordAnswer(qIdx: number, value: string): void {
    this.getAnswer(qIdx).jumbleWordResponse = value.toUpperCase();
    this.updateAnsweredCount();
  }

  appendJumbleChar(qIdx: number, charIndex: number): void {
    const q = this.exercise?.questions?.[qIdx];
    if (!q || q.type !== 'jumble-word') return;
    const char = (q.scrambledText || '')[charIndex];
    if (!char) return;
    const ans = this.getAnswer(qIdx);
    if (!ans.usedJumbleIndices) ans.usedJumbleIndices = [];
    if (ans.usedJumbleIndices.includes(charIndex)) return;
    ans.usedJumbleIndices.push(charIndex);
    const current = ans.jumbleWordResponse || '';
    ans.jumbleWordResponse = (current + char).toUpperCase();
    this.updateAnsweredCount();
  }

  setRearrangeTextAnswer(qIdx: number, value: string): void {
    this.getAnswer(qIdx).rearrangeTextResponse = value.toUpperCase();
    this.updateAnsweredCount();
  }

  isRearrangeUsed(qIdx: number, tokenIndex: number): boolean {
    const ans = this.getAnswer(qIdx);
    return (ans.usedRearrangeIndices || []).includes(tokenIndex);
  }

  appendRearrangeToken(qIdx: number, tokenIndex: number): void {
    const q = this.exercise?.questions?.[qIdx];
    if (!q || q.type !== 'rearrange') return;
    const tokens = q.shuffledTokens || q.rearrangeTokens || [];
    const token = tokens[tokenIndex];
    if (!token) return;
    const ans = this.getAnswer(qIdx);
    if (!ans.usedRearrangeIndices) ans.usedRearrangeIndices = [];
    if (ans.usedRearrangeIndices.includes(tokenIndex)) return;
    ans.usedRearrangeIndices.push(tokenIndex);
    const current = ans.rearrangeTextResponse || '';
    ans.rearrangeTextResponse = (current + (current ? ' ' : '') + token).toUpperCase();
    this.updateAnsweredCount();
  }

  getShuffledTokens(q: any): string[] {
    if (q.shuffledTokens && Array.isArray(q.shuffledTokens)) {
      return q.shuffledTokens;
    }
    if (!this._shuffledTokensCache) this._shuffledTokensCache = new Map();
    const key = q._id || JSON.stringify(q.rearrangeTokens);
    if (!this._shuffledTokensCache.has(key)) {
      const tokens = [...(q.rearrangeTokens || [])];
      for (let i = tokens.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tokens[i], tokens[j]] = [tokens[j], tokens[i]];
      }
      this._shuffledTokensCache.set(key, tokens);
    }
    return this._shuffledTokensCache.get(key)!;
  }
  private _shuffledTokensCache: Map<string, string[]> | null = null;

  selectPin(qIdx: number, pinId: string): void {
    this._selectedPinId = this._selectedPinId === pinId ? null : pinId;
  }
  private _selectedPinId: string | null = null;

  isPinSelected(qIdx: number, pinId: string): boolean {
    return this._selectedPinId === pinId;
  }

  onPinImageClick(event: MouseEvent, qIdx: number): void {
    const ans = this.getAnswer(qIdx);
    if (!ans.imagePinAnswers) ans.imagePinAnswers = [];
    const activeLabel = this.getActiveLabel(qIdx);
    if (!activeLabel || !this._selectedPinId) return;
    const existing = ans.imagePinAnswers.find(a => a.labelId === activeLabel.id);
    if (existing) {
      existing.pinId = this._selectedPinId;
    } else {
      ans.imagePinAnswers.push({ labelId: activeLabel.id, pinId: this._selectedPinId });
    }
    this._selectedPinId = null;
    this.updateAnsweredCount();
  }

  getPinLabelAnswer(qIdx: number, labelId: string): string {
    const ans = this.getAnswer(qIdx);
    const found = (ans.imagePinAnswers || []).find(a => a.labelId === labelId);
    return found?.pinId || '';
  }

  private getActiveLabel(qIdx: number): { id: string; text: string } | null {
    const q = this.exercise?.questions?.[qIdx] as any;
    const labels = q?.labels || [];
    const ans = this.getAnswer(qIdx);
    const answeredIds = new Set((ans.imagePinAnswers || []).map(a => a.labelId));
    return labels.find((l: any) => !answeredIds.has(l.id)) || null;
  }

  getShuffledRights(q: any): string[] {
    if (q.type !== 'matching') return [];
    if (q.shuffledRight && Array.isArray(q.shuffledRight)) {
      return q.shuffledRight;
    }
    const pairs = q.pairs || [];
    const rights = pairs.map((p: any) => p.right).filter(Boolean) as string[];
    if (!this._shuffledRightsCache) this._shuffledRightsCache = new Map();
    const key = q._id || JSON.stringify(rights);
    if (!this._shuffledRightsCache.has(key)) {
      const shuffled = [...rights];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      this._shuffledRightsCache.set(key, shuffled);
    }
    return this._shuffledRightsCache.get(key)!;
  }
  private _shuffledRightsCache: Map<string, string[]> | null = null;

  getJumbleChars(qIdx: number): Array<{ char: string; bold: boolean; disabled: boolean }> {
    const q = this.exercise?.questions?.[qIdx];
    if (!q || q.type !== 'jumble-word') return [];
    const text = q.scrambledText || '';
    const boldLetter = q.boldLetter || '';
    const used = this.getAnswer(qIdx).usedJumbleIndices || [];
    return text.split('').map((ch, i) => ({
      char: ch,
      bold: ch === boldLetter,
      disabled: used.includes(i)
    }));
  }

  getFillBlankSlots(q: ExerciseQuestion): number[] {
    if (q.type !== 'fill-blank') return [];
    const fromAnswers = (q.answers || []).length;
    const fromSentence = (q.sentence || '').match(/_+/g)?.length || 0;
    const count = Math.max(fromAnswers, fromSentence);
    return Array.from({ length: count }, (_, i) => i);
  }

  formatFillBlankSentence(q: ExerciseQuestion): string {
    if (q.type !== 'fill-blank') return '';
    return q.sentence || '';
  }

  getTypeLabel(q: ExerciseQuestion): string {
    const labels: Record<string, string> = {
      mcq: 'Multiple Choice',
      matching: 'Matching',
      'fill-blank': 'Fill Blanks',
      word_bank_fill: 'Word Bank',
      singular_plural: 'Singular/Plural',
      'question-answer': 'Q&A',
      listening: 'Listening',
      'jumble-word': 'Jumble Word',
      rearrange: 'Rearrange',
      image_pin_match: 'Pin Match',
      pronunciation: 'Pronunciation',
      'video-pronunciation': 'Video Pron'
    };
    return labels[q.type] || q.type;
  }

  getAttachmentType(url: string): string {
    if (!url) return 'other';
    const lower = url.toLowerCase().split('?')[0];
    if (/\.(jpe?g|jpg|jfif|png|gif|webp|svg|avif|bmp)$/.test(lower)) return 'image';
    if (/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/.test(lower)) return 'audio';
    if (/\.(mp4|mov|avi|mkv)$/.test(lower)) return 'video';
    return 'other';
  }

  resolveUrl(url: string): string {
    return resolveMediaUrl(url);
  }

  getMcqOptionImageUrl(question: any, oi: number): string {
    const urls = Array.isArray(question?.optionImageUrls) ? question.optionImageUrls : [];
    return String(urls[oi] || '').trim();
  }

  hasMcqOptionImages(question: any): boolean {
    const urls = Array.isArray(question?.optionImageUrls) ? question.optionImageUrls : [];
    return urls.some((u: unknown) => !!String(u || '').trim());
  }

  openFullscreen(event: MouseEvent): void {
    const el = event.target as HTMLElement;
    if (el.requestFullscreen) {
      el.requestFullscreen();
    }
  }

  getQuestionAudioAttachmentUrls(question: any): string[] {
    if (!question) return [];
    const urls: string[] = [];
    if (question.attachmentUrl) urls.push(question.attachmentUrl);
    if (Array.isArray(question.attachmentUrls)) urls.push(...question.attachmentUrls);
    return urls.filter((u: string) => this.getAttachmentType(u) === 'audio');
  }

  getAttachmentAudioCap(question: any): number | null {
    if (!question) return null;
    if (!this.getQuestionAudioAttachmentUrls(question).length) return null;
    const raw = question.attachmentAudioMaxPlaysPerAttempt;
    const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? '').trim(), 10);
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.min(99, Math.floor(n));
  }

  getAudioPlayKey(renderIdx: number, url: string): string {
    return `cb-${renderIdx}-${url}`;
  }

  isContentAudioLimitReached(renderIdx: number, url: string): boolean {
    const item = this.renderList[renderIdx];
    if (!item || item.kind !== 'content-block' || item.attachmentAudioCap == null) return false;
    const used = this.attachmentAudioPlaysUsed[this.getAudioPlayKey(renderIdx, url)] ?? 0;
    return used >= item.attachmentAudioCap;
  }

  getContentAudioPlaysRemaining(renderIdx: number, url: string): number | null {
    const item = this.renderList[renderIdx];
    if (!item || item.kind !== 'content-block' || item.attachmentAudioCap == null) return null;
    const used = this.attachmentAudioPlaysUsed[this.getAudioPlayKey(renderIdx, url)] ?? 0;
    return Math.max(0, item.attachmentAudioCap - used);
  }

  onContentAudioPlay(renderIdx: number, url: string, audioEl: HTMLAudioElement): void {
    const item = this.renderList[renderIdx];
    if (!item || item.kind !== 'content-block' || item.attachmentAudioCap == null) return;
    const key = this.getAudioPlayKey(renderIdx, url);
    const used = (this.attachmentAudioPlaysUsed[key] ?? 0) + 1;
    this.attachmentAudioPlaysUsed[key] = used;
    if (used >= item.attachmentAudioCap) {
      audioEl.pause();
      audioEl.removeAttribute('src');
      audioEl.load();
      this.snackBar.open('Play limit reached for this attempt.', 'Close', { duration: 2800 });
    }
  }

  private updateAnsweredCount(): void {
    const questions = this.exercise?.questions || [];
    let count = 0;
    for (let i = 0; i < questions.length; i++) {
      if (this.isQuestionAnswered(i)) count++;
    }
    this.answeredCount = count;
  }

  private isQuestionAnswered(qIdx: number): boolean {
    const q = this.exercise?.questions?.[qIdx];
    if (!q) return false;
    const ans = this.answers[qIdx];
    if (!ans) return false;

    switch (q.type) {
      case 'mcq': return ans.selectedOptionIndex !== undefined;
      case 'matching': return (ans.matchingResponse || []).length === (q.pairs || []).length;
      case 'fill-blank': return (ans.fillBlankResponses || []).every(r => String(r || '').trim().length > 0);
      case 'word_bank_fill': return (ans.wordBankAnswers || []).length === (q.items || []).length;
      case 'singular_plural': return (ans.singularPluralResponses || []).every(r => String(r || '').trim().length > 0);
      case 'question-answer': return String(ans.qaResponse || '').trim().length > 0;
      case 'listening': return String(ans.listeningText || '').trim().length > 0;
      case 'jumble-word': return String(ans.jumbleWordResponse || '').trim().length > 0;
      case 'rearrange': return String(ans.rearrangeTextResponse || '').trim().length > 0;
      case 'image_pin_match': return (ans.imagePinAnswers || []).length === (q.labels || []).length;
      default: return false;
    }
  }

  submit(): void {
    if (this.submitting) return;

    const questions = this.exercise?.questions || [];
    this.questionErrors = {};

    // Validate all questions are answered
    let hasError = false;
    for (let i = 0; i < questions.length; i++) {
      if (!this.isQuestionAnswered(i)) {
        this.questionErrors[i] = 'This question is not answered yet.';
        hasError = true;
      }
    }

    if (hasError) {
      this.snackBar.open('Some questions are unanswered', 'Close', { duration: 4000, panelClass: ['error-snack'] });
      // Scroll to first error
      const firstErrorIdx = Object.keys(this.questionErrors).map(Number).sort()[0];
      const el = document.querySelectorAll('.question-card')[firstErrorIdx];
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    this.submitting = true;
    this.state = 'submitting';

    const responses = questions.map((q, i) => {
      const ans = this.answers[i] || {};
      const resp: any = { questionIndex: i };

      if (q.type === 'mcq') resp.selectedOptionIndex = ans.selectedOptionIndex;
      else if (q.type === 'matching') resp.matchingResponse = ans.matchingResponse;
      else if (q.type === 'fill-blank') resp.fillBlankResponses = ans.fillBlankResponses;
      else if (q.type === 'word_bank_fill') resp.wordBankAnswers = ans.wordBankAnswers;
      else if (q.type === 'singular_plural') resp.singularPluralResponses = ans.singularPluralResponses;
      else if (q.type === 'question-answer') resp.qaResponse = ans.qaResponse;
      else if (q.type === 'listening') resp.listeningText = ans.listeningText;
      else if (q.type === 'jumble-word') resp.jumbleWordResponse = ans.jumbleWordResponse;
      else if (q.type === 'rearrange') {
        resp.rearrangeTextResponse = ans.rearrangeTextResponse;
        resp.rearrangeTokensResponse = (ans.rearrangeTextResponse || '').split(/\s+/).filter(Boolean);
      }
      else if (q.type === 'image_pin_match') resp.imagePinAnswers = ans.imagePinAnswers;

      return resp;
    });

    const timeSpentSeconds = Math.round((Date.now() - this.startTime) / 1000);

    this.exerciseService.startAttempt(this.exerciseId).subscribe({
      next: (attempt) => {
        this.attemptId = attempt.attemptId;
        this.attemptNumber = attempt.attemptNumber;
        this.exerciseService.submitAttempt(this.exerciseId, this.attemptId, responses, timeSpentSeconds).subscribe({
          next: (result) => {
            this.submitResult = result;
            this.submitting = false;
            this.state = 'submitted';
          },
          error: (err) => {
            this.submitting = false;
            this.state = 'playing';
            this.snackBar.open(err?.error?.error || 'Failed to submit', 'Close', { duration: 4000, panelClass: ['error-snack'] });
          }
        });
      },
      error: (err) => {
        this.submitting = false;
        this.state = 'playing';
        this.snackBar.open(err?.error?.error || 'Failed to start attempt', 'Close', { duration: 4000, panelClass: ['error-snack'] });
      }
    });
  }

  goToReview(): void {
    this.router.navigate(['/digital-exercises', this.exerciseId, 'review'], {
      queryParams: this.attemptId ? { attemptId: this.attemptId } : undefined
    });
  }

  retry(): void {
    this.answers = {};
    this.questionErrors = {};
    this.submitResult = null;
    this.attemptId = '';
    this.attachmentAudioPlaysUsed = {};
    this.currentAudio = null;
    this.startTime = Date.now();
    if (this.exercise) {
      this.initAnswers(this.exercise);
    }
    this.state = 'playing';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  goBack(): void {
    this.router.navigate(['/digital-exercises']);
  }

  private setError(msg: string): void {
    this.errorMessage = msg;
    this.state = 'error';
  }
}
