import { Component, OnInit, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClassFeedbackService } from '../../services/class-feedback.service';

interface FeedbackOption {
  value: string;
  label: string;
  emoji: string;
  foxMood: string; // CSS class for fox animation
}

interface ConfidenceOption {
  value: number;
  label: string;
  foxMood: string;
}

@Component({
  selector: 'app-class-feedback-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './class-feedback-modal.component.html',
  styleUrls: ['./class-feedback-modal.component.scss'],
})
export class ClassFeedbackModalComponent implements OnInit, OnChanges {
  @Input() meetingId: string = '';
  @Input() classTitle: string = 'Your Class';
  @Input() batch: string = '';
  @Input() visible: boolean = false;
  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<void>();

  loading = false;
  submitting = false;
  alreadySubmitted = false;
  error = '';
  successMessage = '';
  step: 'form' | 'success' = 'form';

  // Selected answers
  selectedUnderstanding: string = '';
  selectedPace: string = '';
  selectedConfidence: number = 0;
  selectedMotivation: string = '';

  readonly understandingOptions: FeedbackOption[] = [
    { value: 'not_really', label: 'Not really', emoji: '😕', foxMood: 'fox-sad' },
    { value: 'mostly',     label: 'Mostly',     emoji: '🙂', foxMood: 'fox-ok' },
    { value: 'completely', label: 'Completely', emoji: '😄', foxMood: 'fox-happy' },
  ];

  readonly paceOptions: FeedbackOption[] = [
    { value: 'too_slow',   label: 'Too slow',   emoji: '🐢', foxMood: 'fox-slow' },
    { value: 'just_right', label: 'Just right', emoji: '👍', foxMood: 'fox-ok' },
    { value: 'too_fast',   label: 'Too fast',   emoji: '🐇', foxMood: 'fox-fast' },
  ];

  readonly motivationOptions: FeedbackOption[] = [
    { value: 'not_motivated',      label: 'Not motivated',      emoji: '😴', foxMood: 'fox-sleep' },
    { value: 'somewhat_motivated', label: 'Somewhat motivated', emoji: '🙂', foxMood: 'fox-ok' },
    { value: 'very_motivated',     label: 'Very motivated!',    emoji: '🔥', foxMood: 'fox-fire' },
  ];

  readonly confidenceOptions: ConfidenceOption[] = [
    { value: 1, label: 'Just starting', foxMood: 'fox-sad' },
    { value: 2, label: 'Getting there', foxMood: 'fox-ok' },
    { value: 3, label: 'Very confident', foxMood: 'fox-happy' },
  ];

  constructor(private feedbackService: ClassFeedbackService) {}

  ngOnInit(): void {
    if (this.meetingId && this.visible) this.checkIfAlreadySubmitted();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']?.currentValue === true && this.meetingId) {
      this.reset();
      this.checkIfAlreadySubmitted();
    }
  }

  private reset(): void {
    this.selectedUnderstanding = '';
    this.selectedPace = '';
    this.selectedConfidence = 0;
    this.selectedMotivation = '';
    this.error = '';
    this.successMessage = '';
    this.step = 'form';
    this.alreadySubmitted = false;
  }

  private checkIfAlreadySubmitted(): void {
    if (!this.meetingId) return;
    this.loading = true;
    this.feedbackService.checkSubmitted(this.meetingId).subscribe({
      next: (res) => {
        this.loading = false;
        if (res.submitted) {
          this.alreadySubmitted = true;
          this.step = 'success';
          this.successMessage = 'You already shared your feedback for this class. Thank you! 🦊';
        }
      },
      error: () => { this.loading = false; }
    });
  }

  get isFormValid(): boolean {
    return !!(
      this.selectedUnderstanding &&
      this.selectedPace &&
      this.selectedConfidence > 0 &&
      this.selectedMotivation
    );
  }

  selectUnderstanding(value: string): void { this.selectedUnderstanding = value; }
  selectPace(value: string): void { this.selectedPace = value; }
  selectConfidence(stars: number): void { this.selectedConfidence = stars; }
  selectMotivation(value: string): void { this.selectedMotivation = value; }

  onSubmit(): void {
    if (!this.isFormValid || this.submitting) return;
    this.submitting = true;
    this.error = '';

    this.feedbackService.submitFeedback({
      meetingId: this.meetingId,
      understanding: this.selectedUnderstanding as any,
      pace: this.selectedPace as any,
      confidence: this.selectedConfidence as any,
      motivation: this.selectedMotivation as any,
    }).subscribe({
      next: (res) => {
        this.submitting = false;
        if (res.success) {
          this.step = 'success';
          this.successMessage = 'Thank you for your feedback! 🦊✨';
          this.submitted.emit();
        } else {
          this.error = res.message || 'Something went wrong.';
        }
      },
      error: (err) => {
        this.submitting = false;
        this.error = err?.error?.message || 'Failed to submit. Please try again.';
      }
    });
  }

  close(): void {
    this.closed.emit();
  }
}
