import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  buildExpectedHighlightTokens,
  buildTranscriptHighlightTokens,
  PronCompareToken,
} from '../../utils/pronunciation-compare.util';

@Component({
  selector: 'app-pronunciation-comparison-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pronunciation-comparison-view.component.html',
  styleUrls: ['./pronunciation-comparison-view.component.css'],
})
export class PronunciationComparisonViewComponent implements OnChanges {
  @Input() expectedText = '';
  @Input() transcriptText = '';
  @Input() missingWords: string[] = [];
  @Input() extraWords: string[] = [];
  @Input() matchedWords: string[] = [];

  expectedTokens: PronCompareToken[] = [];
  transcriptTokens: PronCompareToken[] = [];

  ngOnChanges(): void {
    this.expectedTokens = buildExpectedHighlightTokens(
      this.expectedText,
      this.missingWords,
      this.matchedWords
    );
    this.transcriptTokens = buildTranscriptHighlightTokens(
      this.transcriptText,
      this.extraWords,
      this.matchedWords
    );
  }
}
