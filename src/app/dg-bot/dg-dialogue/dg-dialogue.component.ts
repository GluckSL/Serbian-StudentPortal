import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

export type DgDialogueVariant = 'default' | 'success' | 'encourage' | 'soft';

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
  @Output() replayTts = new EventEmitter<void>();
}
