import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { SprechenCard } from '../sprechen-exam.types';

@Component({
  selector: 'app-exam-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="exam-card" [ngClass]="'exam-card--' + (card?.type || 'keyword')">
      <div class="exam-card__inner">
        <!-- Teil 1: keyword grid -->
        <ng-container *ngIf="card?.type === 'keywords'">
          <p class="exam-card__label exam-card__label--small">Stellen Sie sich vor</p>
          <ul class="exam-card__keywords">
            <li *ngFor="let kw of keywords" class="exam-card__kw">{{ kw }}</li>
          </ul>
        </ng-container>

        <!-- Teil 2: single keyword -->
        <ng-container *ngIf="card?.type === 'keyword'">
          <p class="exam-card__label exam-card__label--small">Stichwort</p>
          <p class="exam-card__word">{{ card?.content }}</p>
        </ng-container>

        <!-- Teil 3: object / situation -->
        <ng-container *ngIf="card?.type === 'object'">
          <img
            *ngIf="card?.imageUrl"
            [src]="card?.imageUrl"
            class="exam-card__img"
            alt="{{ card?.content }}"
          />
          <p class="exam-card__word">{{ card?.content }}</p>
        </ng-container>
      </div>
    </div>
  `,
  styles: [`
    .exam-card {
      background: #fff;
      border: 2px solid #3949ab;
      border-radius: 12px;
      padding: 20px 24px;
      min-width: 220px;
      min-height: 100px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px rgba(57,73,171,.14);
      animation: cardIn .3s ease;
    }

    @keyframes cardIn {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .exam-card__inner {
      text-align: center;
      width: 100%;
    }

    .exam-card__label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: #7986cb;
      margin: 0 0 8px;
    }

    .exam-card__keywords {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
    }

    .exam-card__kw {
      background: #e8eaf6;
      color: #283593;
      border-radius: 20px;
      padding: 4px 14px;
      font-size: 14px;
      font-weight: 600;
    }

    .exam-card__word {
      font-size: 32px;
      font-weight: 700;
      color: #283593;
      margin: 0;
      letter-spacing: .01em;
    }

    .exam-card__img {
      max-height: 80px;
      object-fit: contain;
      margin-bottom: 10px;
    }
  `],
})
export class ExamCardComponent {
  @Input() card: SprechenCard | null = null;

  get keywords(): string[] {
    if (!this.card?.content) return [];
    return this.card.content.split(',').map((k) => k.trim()).filter(Boolean);
  }
}
