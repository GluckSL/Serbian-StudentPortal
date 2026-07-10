import { Component, HostListener, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { resolveMediaUrl } from '../../utils/media-url';
import type { SprechenCard, SprechenA2TimetableSlot } from '../sprechen-exam.types';

@Component({
  selector: 'app-exam-card-panel',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="exam-card-panel" [class.exam-card-panel--hero]="hero" *ngIf="card">
      <p class="exam-card-panel__label" *ngIf="cardLabel">{{ cardLabel }}</p>

      <!-- A2 question card (Fragen zur Person) -->
      <div class="exam-card-panel__a2-question" *ngIf="card.type === 'a2_question'">
        <p class="exam-card-panel__a2-sublabel">{{ card.sublabel || 'Fragen zur Person' }}</p>
        <p class="exam-card-panel__a2-prompt">{{ card.content }}</p>
        <button *ngIf="hasImage" type="button" class="exam-card-panel__img-btn mt-1" (click)="openLightbox()">
          <img [src]="imageSrc" [alt]="card.content" class="exam-card-panel__img" />
          <span class="exam-card-panel__zoom-hint"><mat-icon>zoom_in</mat-icon></span>
        </button>
      </div>

      <!-- A2 monologue card (von sich erzählen) -->
      <div class="exam-card-panel__a2-monologue" *ngIf="card.type === 'a2_monologue'">
        <p class="exam-card-panel__a2-mono-title">{{ card.content }}</p>
        <div class="exam-card-panel__a2-mono-spokes" *ngIf="subPrompts.length">
          <span *ngFor="let sp of subPrompts" class="exam-card-panel__a2-spoke">{{ sp }}</span>
        </div>
        <button *ngIf="hasImage" type="button" class="exam-card-panel__img-btn mt-1" (click)="openLightbox()">
          <img [src]="imageSrc" [alt]="card.content" class="exam-card-panel__img" />
          <span class="exam-card-panel__zoom-hint"><mat-icon>zoom_in</mat-icon></span>
        </button>
      </div>

      <!-- A2 timetable card -->
      <div class="exam-card-panel__a2-timetable" *ngIf="card.type === 'a2_timetable'">
        <p class="exam-card-panel__a2-timetable-date" *ngIf="card.dateLabel">{{ card.dateLabel }}</p>
        <button *ngIf="hasImage" type="button" class="exam-card-panel__img-btn" (click)="openLightbox()" aria-label="Prikaži raspored na celom ekranu">
          <img [src]="imageSrc" alt="Raspored učenika" class="exam-card-panel__img exam-card-panel__img--timetable" />
          <span class="exam-card-panel__zoom-hint"><mat-icon>zoom_in</mat-icon> Tapnite za uvećanje</span>
        </button>
        <ul class="exam-card-panel__a2-slots" *ngIf="timetableSlots.length">
          <li *ngFor="let s of timetableSlots" [class.exam-card-panel__a2-slot--busy]="s.busy">
            <span class="exam-card-panel__a2-slot-time">{{ s.start }}–{{ s.end }}</span>
            <span class="exam-card-panel__a2-slot-act">{{ s.activity }}</span>
          </li>
        </ul>
      </div>

      <!-- Standard A1 card types -->
      <button
        *ngIf="hasImage && card.type !== 'a2_question' && card.type !== 'a2_monologue' && card.type !== 'a2_timetable'"
        type="button"
        class="exam-card-panel__img-btn"
        (click)="openLightbox()"
        [attr.aria-label]="'Otvori sliku kartice na celom ekranu'"
      >
        <img [src]="imageSrc" [alt]="cardAlt" class="exam-card-panel__img" />
        <span class="exam-card-panel__zoom-hint">
          <mat-icon>zoom_in</mat-icon>
          Tapnite za uvećanje
        </span>
      </button>

      <div class="exam-card-panel__fallback" *ngIf="!hasImage && keywords.length && card.type !== 'a2_question' && card.type !== 'a2_monologue' && card.type !== 'a2_timetable'">
        <ul class="exam-card-panel__keywords">
          <li *ngFor="let kw of keywords" class="exam-card-panel__kw">{{ kw }}</li>
        </ul>
      </div>

      <p class="exam-card-panel__word" *ngIf="!hasImage && card.type === 'keyword'">{{ card.content }}</p>
      <p class="exam-card-panel__word exam-card-panel__word--sm" *ngIf="!hasImage && card.type === 'object'">
        {{ card.content }}
      </p>
    </div>

    <div
      class="exam-card-lightbox"
      *ngIf="lightboxOpen && hasImage"
      role="dialog"
      aria-modal="true"
      (click)="closeLightbox()"
    >
      <button type="button" class="exam-card-lightbox__close" (click)="closeLightbox(); $event.stopPropagation()">
        <mat-icon>close</mat-icon>
      </button>
      <img
        [src]="imageSrc"
        [alt]="cardAlt"
        class="exam-card-lightbox__img"
        (click)="$event.stopPropagation()"
      />
    </div>
  `,
  styles: [`
    .exam-card-panel {
      width: 100%;
      max-width: 200px;
      margin: 0 auto 12px;
      animation: examCardIn 0.3s ease;
    }

    @keyframes examCardIn {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: none; }
    }

    .exam-card-panel__label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #7986cb;
      text-align: center;
      margin: 0 0 8px;
    }

    .exam-card-panel__img-btn {
      display: block;
      width: 100%;
      padding: 0;
      border: 2px solid #3949ab;
      border-radius: 12px;
      background: #fff;
      overflow: hidden;
      cursor: zoom-in;
      box-shadow: 0 4px 16px rgba(57, 73, 171, 0.18);
      position: relative;
    }

    .exam-card-panel__img-btn:hover .exam-card-panel__zoom-hint {
      opacity: 1;
    }

    .exam-card-panel__img {
      display: block;
      width: 100%;
      max-height: 160px;
      object-fit: contain;
      background: #f8f9fc;
    }

    .exam-card-panel__zoom-hint {
      position: absolute;
      inset: auto 0 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 6px;
      font-size: 11px;
      font-weight: 600;
      color: #fff;
      background: linear-gradient(transparent, rgba(40, 53, 147, 0.85));
      opacity: 0.85;
      transition: opacity 0.15s;
    }

    .exam-card-panel__zoom-hint mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .exam-card-panel__keywords {
      list-style: none;
      padding: 8px;
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: center;
      background: #fff;
      border: 2px solid #3949ab;
      border-radius: 12px;
    }

    .exam-card-panel__kw {
      background: #e8eaf6;
      color: #283593;
      border-radius: 16px;
      padding: 3px 10px;
      font-size: 12px;
      font-weight: 600;
    }

    .exam-card-panel__word {
      text-align: center;
      font-size: 22px;
      font-weight: 700;
      color: #283593;
      margin: 0;
      padding: 12px;
      background: #fff;
      border: 2px solid #3949ab;
      border-radius: 12px;
    }

    .exam-card-panel__word--sm {
      font-size: 16px;
    }

    .exam-card-lightbox {
      position: fixed;
      inset: 0;
      z-index: 10000;
      background: rgba(15, 18, 40, 0.92);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      cursor: zoom-out;
    }

    .exam-card-lightbox__close {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 44px;
      height: 44px;
      border: none;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .exam-card-lightbox__img {
      max-width: min(96vw, 900px);
      max-height: min(92vh, 900px);
      object-fit: contain;
      border-radius: 8px;
      box-shadow: 0 8px 40px rgba(0, 0, 0, 0.45);
      cursor: default;
    }

    /* ── A2 card styles ─────────────────────── */
    .exam-card-panel__a2-question {
      background: #fff;
      border: 2px solid #3949ab;
      border-radius: 12px;
      padding: 14px 16px 12px;
      text-align: center;
    }
    .exam-card-panel__a2-sublabel {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #7986cb;
      margin: 0 0 6px;
    }
    .exam-card-panel__a2-prompt {
      font-size: 24px;
      font-weight: 800;
      color: #1a237e;
      margin: 0;
    }

    .exam-card-panel__a2-monologue {
      background: #fff;
      border: 2px solid #3949ab;
      border-radius: 12px;
      padding: 12px;
      text-align: center;
    }
    .exam-card-panel__a2-mono-title {
      font-size: 14px;
      font-weight: 700;
      color: #1a237e;
      margin: 0 0 10px;
    }
    .exam-card-panel__a2-mono-spokes {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: center;
    }
    .exam-card-panel__a2-spoke {
      background: #e8eaf6;
      color: #283593;
      border-radius: 16px;
      padding: 3px 10px;
      font-size: 11px;
      font-weight: 600;
    }

    .exam-card-panel__a2-timetable {
      background: #fff;
      border: 2px solid #3949ab;
      border-radius: 12px;
      padding: 10px;
      max-width: 220px;
    }
    .exam-card-panel__a2-timetable-date {
      font-size: 11px;
      font-weight: 700;
      color: #3949ab;
      margin: 0 0 6px;
      text-align: center;
    }
    .exam-card-panel__img--timetable {
      max-height: 180px;
    }
    .exam-card-panel__a2-slots {
      list-style: none;
      margin: 6px 0 0;
      padding: 0;
      font-size: 10px;
    }
    .exam-card-panel__a2-slots li {
      display: flex;
      gap: 6px;
      padding: 2px 0;
      border-top: 1px solid #e8eaf6;
    }
    .exam-card-panel__a2-slot--busy {
      color: #c62828;
    }
    .exam-card-panel__a2-slot-time {
      font-weight: 700;
      min-width: 70px;
      flex-shrink: 0;
    }
    .exam-card-panel__a2-slot-act {
      flex: 1;
    }

    /* ── Hero size (exam player center stage) ───────────────────────── */
    .exam-card-panel--hero {
      width: 100%;
      max-width: none;
      margin: 0;
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .exam-card-panel--hero > .exam-card-panel__a2-question,
    .exam-card-panel--hero > .exam-card-panel__a2-monologue,
    .exam-card-panel--hero > .exam-card-panel__a2-timetable,
    .exam-card-panel--hero > .exam-card-panel__img-btn,
    .exam-card-panel--hero > .exam-card-panel__fallback,
    .exam-card-panel--hero > .exam-card-panel__word {
      width: 100%;
      box-sizing: border-box;
    }

    .exam-card-panel--hero > .exam-card-panel__a2-question,
    .exam-card-panel--hero > .exam-card-panel__a2-monologue,
    .exam-card-panel--hero > .exam-card-panel__a2-timetable {
      flex: 1;
    }

    .exam-card-panel--hero .exam-card-panel__a2-question {
      padding: 28px 32px;
      min-height: min(44vh, 400px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border-radius: 20px;
      border-width: 3px;
    }

    .exam-card-panel--hero .exam-card-panel__a2-sublabel {
      font-size: 14px;
      margin-bottom: 16px;
    }

    .exam-card-panel--hero .exam-card-panel__a2-prompt {
      font-size: clamp(32px, 5vw, 48px);
      line-height: 1.2;
      width: 100%;
    }

    .exam-card-panel--hero .exam-card-panel__img-btn {
      width: 100%;
      margin-top: 16px;
    }

    .exam-card-panel--hero .exam-card-panel__img {
      width: 100%;
      max-height: min(40vh, 340px);
      object-fit: contain;
    }

    .exam-card-panel--hero .exam-card-panel__a2-monologue {
      padding: 28px 24px;
      min-height: min(52vh, 420px);
      border-radius: 20px;
      border-width: 3px;
    }

    .exam-card-panel--hero .exam-card-panel__a2-mono-title {
      font-size: clamp(22px, 3.5vw, 32px);
      margin-bottom: 20px;
    }

    .exam-card-panel--hero .exam-card-panel__a2-spoke {
      font-size: 15px;
      padding: 8px 16px;
    }

    .exam-card-panel--hero .exam-card-panel__a2-timetable {
      max-width: 100%;
      width: 100%;
      padding: 16px;
      min-height: min(52vh, 420px);
      border-radius: 20px;
      border-width: 3px;
    }

    .exam-card-panel--hero .exam-card-panel__a2-timetable-date {
      font-size: 16px;
      margin-bottom: 12px;
    }

    .exam-card-panel--hero .exam-card-panel__img--timetable {
      max-height: min(44vh, 360px);
    }

    .exam-card-panel--hero .exam-card-panel__a2-slots {
      font-size: 13px;
    }

    .exam-card-panel--hero .exam-card-panel__word {
      font-size: clamp(28px, 5vw, 44px);
      padding: 28px;
      min-height: min(40vh, 320px);
      display: flex;
      align-items: center;
      justify-content: center;
    }
  `],
})
export class ExamCardPanelComponent {
  @Input() card: SprechenCard | null = null;
  /** Large layout for the exam player center stage. */
  @Input() hero = false;

  lightboxOpen = false;

  get hasImage(): boolean {
    return !!(this.card?.imageUrl || '').trim();
  }

  get imageSrc(): string {
    return resolveMediaUrl(this.card?.imageUrl);
  }

  get cardAlt(): string {
    return this.card?.content || 'Exam card';
  }

  get cardLabel(): string {
    if (!this.card) return '';
    if (this.card.type === 'keywords') return 'Stellen Sie sich vor';
    if (this.card.type === 'keyword') return 'Stichwort';
    if (this.card.type === 'object') return 'Gegenstand';
    if (this.card.type === 'a2_question') return '';
    if (this.card.type === 'a2_monologue') return 'Erzählen Sie';
    if (this.card.type === 'a2_timetable') return 'Ihr Terminkalender';
    return '';
  }

  get keywords(): string[] {
    if (!this.card?.content || this.card.type !== 'keywords') return [];
    return this.card.content.split(',').map((k) => k.trim()).filter(Boolean);
  }

  get subPrompts(): string[] {
    return this.card?.subPrompts ?? [];
  }

  get timetableSlots(): SprechenA2TimetableSlot[] {
    return this.card?.slots ?? [];
  }

  openLightbox(): void {
    if (this.hasImage) this.lightboxOpen = true;
  }

  closeLightbox(): void {
    this.lightboxOpen = false;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeLightbox();
  }
}
