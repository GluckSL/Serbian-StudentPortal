import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-dg-controls',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  templateUrl: './dg-controls.component.html',
  styleUrl: './dg-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DgControlsComponent {
  @Input() canReplay = true;
  @Input() canNext = false;
  @Input() showSkip = true;
  @Input() busy = false;

  @Output() replay = new EventEmitter<void>();
  @Output() next = new EventEmitter<void>();
  @Output() skip = new EventEmitter<void>();
}
