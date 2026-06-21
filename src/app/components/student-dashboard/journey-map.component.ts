import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

interface Checkpoint {
  level: string;
  label: string;
  day: number;
  icon: string;
}

@Component({
  selector: 'app-journey-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './journey-map.component.html',
  styleUrls: ['./journey-map.component.scss'],
})
export class JourneyMapComponent implements OnInit {
  @Input() currentDay = 0;
  @Input() journeyLength = 200;
  @Input() studentName = '';

  currentCheckpointIndex = -1;

  readonly checkpoints: Checkpoint[] = [
    { level: 'A1', label: 'Start', day: 1, icon: 'flag' },
    { level: 'A2', label: 'A1 geschafft!', day: 43, icon: 'menu_book' },
    { level: 'B1', label: 'A2 geschafft!', day: 85, icon: 'chat' },
    { level: 'B2', label: 'B1 geschafft!', day: 146, icon: 'emoji_events' },
    { level: 'C1', label: 'B2 geschafft!', day: 200, icon: 'flight' },
    { level: 'C2', label: 'Ziel erreicht!', day: 200, icon: 'star' },
  ];

  readonly nodeX = [70, 246, 422, 598, 774, 930];
  readonly nodeY = [215, 238, 205, 228, 240, 215];

  readonly roadPath =
    'M 70 215 C 128 240, 187 230, 246 238 C 305 246, 364 195, 422 205 C 481 215, 540 230, 598 228 C 656 226, 715 245, 774 240 C 833 235, 881 218, 930 215';

  readonly cityscapePath =
    'M0 340 L0 275 L25 275 L25 250 L45 250 L45 265 L75 265 L75 235 L105 235 L105 260 L135 260 L135 245 L165 245 L165 225 L195 225 L195 255 L225 255 L225 240 L255 240 L255 220 L285 220 L285 250 L315 250 L315 230 L345 230 L345 255 L375 255 L375 240 L405 240 L405 260 L435 260 L435 230 L465 230 L465 250 L495 250 L495 235 L525 235 L525 215 L555 215 L555 245 L585 245 L585 225 L615 225 L615 250 L645 250 L645 235 L675 235 L675 255 L705 255 L705 240 L735 240 L735 220 L765 220 L765 245 L795 245 L795 230 L825 230 L825 252 L855 252 L855 232 L885 232 L885 250 L915 250 L915 265 L945 265 L945 245 L975 245 L975 260 L1000 260 L1000 340 Z';

  ngOnInit(): void {
    this.computeCurrentCheckpoint();
  }

  private computeCurrentCheckpoint(): void {
    if (this.currentDay <= 0) {
      this.currentCheckpointIndex = -1;
      return;
    }
    for (let i = this.checkpoints.length - 1; i >= 0; i--) {
      if (this.currentDay >= this.checkpoints[i].day) {
        this.currentCheckpointIndex = i;
        return;
      }
    }
    this.currentCheckpointIndex = -1;
  }

  get initials(): string {
    if (!this.studentName) return '?';
    const parts = this.studentName.trim().split(/\s+/);
    return parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0][0].toUpperCase();
  }

  get completionPct(): number {
    return this.journeyLength
      ? Math.min(100, Math.round((this.currentDay / this.journeyLength) * 100))
      : 0;
  }

  isCompleted(i: number): boolean {
    return i < this.currentCheckpointIndex;
  }

  isCurrent(i: number): boolean {
    return i === this.currentCheckpointIndex;
  }

  isLocked(i: number): boolean {
    return i > this.currentCheckpointIndex;
  }

  isStemActive(i: number): boolean {
    return i <= this.currentCheckpointIndex;
  }

  nodeLeftPct(i: number): string {
    return (this.nodeX[i] / 1000) * 100 + '%';
  }

  nodeCenterTopPct(): string {
    return (115 / 340) * 100 + '%';
  }

  stemTopPct(): string {
    return ((115 + 22) / 340) * 100 + '%';
  }

  stemHeightPct(i: number): string {
    const h = this.nodeY[i] - 137;
    return Math.max(0, (h / 340) * 100) + '%';
  }

  labelBelowRoadPct(): string {
    return (290 / 340) * 100 + '%';
  }

  get roadTransitionPct(): number {
    const idx = Math.max(0, this.currentCheckpointIndex);
    return ((this.nodeX[idx] - 70) / (930 - 70)) * 100;
  }
}
