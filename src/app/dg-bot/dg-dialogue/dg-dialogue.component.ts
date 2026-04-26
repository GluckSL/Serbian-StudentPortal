import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

export type DgDialogueVariant = 'default' | 'success' | 'encourage' | 'soft';

/** Which CC (closed-caption) track is currently visible. */
type CcMode = 'none' | 'en' | 'ta';

@Component({
  selector: 'app-dg-dialogue',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  templateUrl: './dg-dialogue.component.html',
  styleUrl: './dg-dialogue.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DgDialogueComponent {
  @Input() line = '';
  @Input() subtitle = '';
  @Input() showTts = true;
  @Input() disabled = false;
  /** Visual tone for feedback (success confetti-friendly, gentle incorrect). */
  @Input() variant: DgDialogueVariant = 'default';

  /**
   * CC English text — the original AI response in the target language.
   * When non-empty a "CC EN" toggle button is shown.
   */
  @Input() ccEnglish = '';

  /**
   * CC Tamil translation of the AI response.
   * When non-empty a "CC TA" toggle button is shown.
   */
  @Input() ccTamil = '';

  @Output() replayTts = new EventEmitter<void>();

  ccMode: CcMode = 'none';

  get hasCc(): boolean {
    return !!(this.ccEnglish || this.ccTamil);
  }

  get ccDisplayText(): string {
    if (this.ccMode === 'en') return this.ccEnglish;
    if (this.ccMode === 'ta') return this.ccTamil;
    return '';
  }

  toggleCc(mode: CcMode): void {
    this.ccMode = this.ccMode === mode ? 'none' : mode;
  }
}
