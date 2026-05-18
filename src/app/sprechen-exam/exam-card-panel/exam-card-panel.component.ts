import { Component, HostListener, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { resolveMediaUrl } from '../../utils/media-url';
import type { SprechenCard } from '../sprechen-exam.types';

@Component({
  selector: 'app-exam-card-panel',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="exam-card-panel" *ngIf="card">
      <p class="exam-card-panel__label" *ngIf="cardLabel">{{ cardLabel }}</p>

      <button
        *ngIf="hasImage"
        type="button"
        class="exam-card-panel__img-btn"
        (click)="openLightbox()"
        [attr.aria-label]="'Open card image full screen'"
      >
        <img [src]="imageSrc" [alt]="cardAlt" class="exam-card-panel__img" />
        <span class="exam-card-panel__zoom-hint">
          <mat-icon>zoom_in</mat-icon>
          Tap to enlarge
        </span>
      </button>

      <div class="exam-card-panel__fallback" *ngIf="!hasImage && keywords.length">
        <ul class="exam-card-panel__keywords">
          <li *ngFor="let kw of keywords" class="exam-card-panel__kw">{{ kw }}</li>
        </ul>
      </div>

      <p class="exam-card-panel__word" *ngIf="!hasImage && card?.type === 'keyword'">{{ card?.content }}</p>
      <p class="exam-card-panel__word exam-card-panel__word--sm" *ngIf="!hasImage && card?.type === 'object'">
        {{ card?.content }}
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
  `],
})
export class ExamCardPanelComponent {
  @Input() card: SprechenCard | null = null;

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
    return '';
  }

  get keywords(): string[] {
    if (!this.card?.content || this.card.type !== 'keywords') return [];
    return this.card.content.split(',').map((k) => k.trim()).filter(Boolean);
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
