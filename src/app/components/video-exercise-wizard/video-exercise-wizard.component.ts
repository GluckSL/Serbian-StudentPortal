// src/app/components/video-exercise-wizard/video-exercise-wizard.component.ts

import { Component, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { DigitalExerciseService, VideoExerciseFeedbackItem } from '../../services/digital-exercise.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../../shared/material.module';
import { resolveMediaUrl } from '../../utils/media-url';

interface VideoClip {
  videoUrl: string;
  caption: string;
  secondaryCaption: string;
  secondaryCaptionAtSeconds: number;
  acceptedVariants: string[];
  videoUploading: boolean;
  points: number;
}

interface FeedbackAudioRow {
  audioUrl: string;
  caption: string;
  uploading: boolean;
}

@Component({
  selector: 'app-video-exercise-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  templateUrl: './video-exercise-wizard.component.html',
  styleUrls: ['./video-exercise-wizard.component.css']
})
export class VideoExerciseWizardComponent {
  step: 1 | 2 = 1;
  saving = false;

  // ── Step 1: Exercise Info ──────────────────────────────────────────────────
  title = '';
  description = '';
  targetLanguage: 'English' | 'German' = 'German';
  nativeLanguage: 'English' | 'Tamil' | 'Sinhala' = 'English';
  level = 'A1';
  category = 'Vocabulary';
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced' = 'Beginner';
  estimatedDuration = 10;
  courseDayStr = '';
  visibleToStudents = false;

  levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  categories = ['Grammar', 'Vocabulary', 'Conversation', 'Reading', 'Writing', 'Listening', 'Pronunciation'];
  difficulties: Array<'Beginner' | 'Intermediate' | 'Advanced'> = ['Beginner', 'Intermediate', 'Advanced'];
  languages = ['English', 'German'];
  nativeLanguages = ['English', 'Tamil', 'Sinhala'];

  // ── Step 2: Video Clips ────────────────────────────────────────────────────
  clips: VideoClip[] = [this.newClip()];

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  currentClipIndex = -1;

  readonly maxFeedbackClips = 4;

  @ViewChild('feedbackFileInput') feedbackFileInput!: ElementRef<HTMLInputElement>;
  private feedbackUploadTarget: { kind: 'success' | 'retry'; index: number } | null = null;

  /** When the student passes a clip, one of these is chosen at random to play (optional). */
  successFeedbackRows: FeedbackAudioRow[] = [];
  /** When the student fails a clip, one of these is chosen at random (optional). */
  retryFeedbackRows: FeedbackAudioRow[] = [];

  constructor(
    private exerciseService: DigitalExerciseService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {}

  // ── Info helpers ─────────────────────────────────────────────────────────

  get courseDayAsNumber(): number | null {
    const t = this.courseDayStr.trim();
    if (!t) return null;
    const p = parseInt(t, 10);
    return Number.isFinite(p) ? p : null;
  }

  onCourseDayInput(v: number | string | null): void {
    if (v === '' || v === null || v === undefined) { this.courseDayStr = ''; return; }
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    if (!Number.isFinite(n)) { this.courseDayStr = ''; return; }
    this.courseDayStr = String(Math.min(200, Math.max(1, Math.round(n))));
  }

  isStep1Valid(): boolean {
    return !!this.title.trim() && !!this.description.trim();
  }

  goToStep2(): void {
    if (!this.isStep1Valid()) {
      this.snackBar.open('Please fill in Title and Description before continuing.', 'Close', { duration: 3000 });
      return;
    }
    this.step = 2;
  }

  // ── Clip helpers ─────────────────────────────────────────────────────────

  private newClip(): VideoClip {
    return {
      videoUrl: '',
      caption: '',
      secondaryCaption: '',
      secondaryCaptionAtSeconds: 5,
      acceptedVariants: [],
      videoUploading: false,
      points: 1
    };
  }

  addClip(): void {
    this.clips.push(this.newClip());
  }

  removeClip(i: number): void {
    if (this.clips.length === 1) return;
    this.clips.splice(i, 1);
  }

  triggerFile(index: number): void {
    this.currentClipIndex = index;
    this.fileInput?.nativeElement?.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const idx = this.currentClipIndex;
    this.currentClipIndex = -1;
    input.value = '';
    if (!file || idx < 0) return;
    if (file.size > 500 * 1024 * 1024) {
      this.snackBar.open('File too large (max 500 MB)', 'Close', { duration: 3000 });
      return;
    }
    const clip = this.clips[idx];
    clip.videoUploading = true;
    this.exerciseService.uploadVideoMedia(file).subscribe({
      next: (res) => {
        clip.videoUrl = res.url;
        clip.videoUploading = false;
        this.snackBar.open('Video uploaded!', '', { duration: 2000 });
      },
      error: (err) => {
        clip.videoUploading = false;
        this.snackBar.open(err.error?.error || 'Upload failed', 'Close', { duration: 4000 });
      }
    });
  }

  addVariant(clip: VideoClip): void { clip.acceptedVariants.push(''); }
  removeVariant(clip: VideoClip, i: number): void { clip.acceptedVariants.splice(i, 1); }

  addSuccessFeedbackRow(): void {
    if (this.successFeedbackRows.length >= this.maxFeedbackClips) return;
    this.successFeedbackRows.push({ audioUrl: '', caption: '', uploading: false });
  }

  removeSuccessFeedbackRow(i: number): void {
    this.successFeedbackRows.splice(i, 1);
  }

  addRetryFeedbackRow(): void {
    if (this.retryFeedbackRows.length >= this.maxFeedbackClips) return;
    this.retryFeedbackRows.push({ audioUrl: '', caption: '', uploading: false });
  }

  removeRetryFeedbackRow(i: number): void {
    this.retryFeedbackRows.splice(i, 1);
  }

  triggerFeedbackAudio(kind: 'success' | 'retry', index: number): void {
    this.feedbackUploadTarget = { kind, index };
    this.feedbackFileInput?.nativeElement?.click();
  }

  onFeedbackFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const target = this.feedbackUploadTarget;
    this.feedbackUploadTarget = null;
    input.value = '';
    if (!file || !target) return;
    const rows = target.kind === 'success' ? this.successFeedbackRows : this.retryFeedbackRows;
    const row = rows[target.index];
    if (!row) return;
    if (file.size > 40 * 1024 * 1024) {
      this.snackBar.open('Audio file too large (max 40 MB)', 'Close', { duration: 3000 });
      return;
    }
    row.uploading = true;
    this.exerciseService.uploadListeningMedia(file).subscribe({
      next: (res) => {
        row.audioUrl = res.url;
        row.uploading = false;
        this.snackBar.open('Audio uploaded', '', { duration: 2000 });
      },
      error: (err) => {
        row.uploading = false;
        this.snackBar.open(err.error?.error || 'Upload failed', 'Close', { duration: 4000 });
      }
    });
  }

  private mapFeedbackRows(rows: FeedbackAudioRow[]): VideoExerciseFeedbackItem[] {
    return rows
      .filter((r) => r.audioUrl.trim())
      .map((r) => ({ audioUrl: r.audioUrl.trim(), caption: r.caption.trim() }));
  }

  getMediaFullUrl(relative: string): string {
    return resolveMediaUrl(relative);
  }

  isStep2Valid(): boolean {
    return this.clips.length > 0 && this.clips.every(c => c.videoUrl.trim() && c.caption.trim());
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  save(): void {
    const feedbackBusy =
      this.successFeedbackRows.some((r) => r.uploading) || this.retryFeedbackRows.some((r) => r.uploading);
    if (feedbackBusy) {
      this.snackBar.open('Wait for feedback audio uploads to finish before saving.', 'Close', { duration: 4000 });
      return;
    }
    if (this.clips.some((c) => c.videoUploading)) {
      this.snackBar.open('Wait for video uploads to finish before saving.', 'Close', { duration: 4000 });
      return;
    }
    if (!this.isStep1Valid()) { this.step = 1; return; }
    if (!this.isStep2Valid()) {
      this.snackBar.open('Each clip needs a video and a pronunciation word.', 'Close', { duration: 3000 });
      return;
    }

    let courseDay: number | null = null;
    const dayTrim = this.courseDayStr.trim();
    if (dayTrim) {
      const p = parseInt(dayTrim, 10);
      if (!Number.isFinite(p) || p < 1 || p > 200) {
        this.snackBar.open('Journey day must be 1–200', 'Close', { duration: 3000 });
        this.step = 1;
        return;
      }
      courseDay = p;
    }

    this.saving = true;
    const payload: any = {
      title: this.title.trim(),
      description: this.description.trim(),
      targetLanguage: this.targetLanguage,
      nativeLanguage: this.nativeLanguage,
      level: this.level,
      category: this.category,
      difficulty: this.difficulty,
      estimatedDuration: this.estimatedDuration,
      courseDay,
      visibleToStudents: this.visibleToStudents,
      questions: this.clips.map(c => ({
        type: 'video-pronunciation',
        videoUrl: c.videoUrl,
        caption: c.caption,
        secondaryCaption: c.secondaryCaption.trim(),
        secondaryCaptionAtSeconds: Math.max(0, Math.min(600, Math.round(Number(c.secondaryCaptionAtSeconds) || 5))),
        acceptedVariants: c.acceptedVariants.filter(v => v.trim()),
        points: c.points
      })),
      videoSuccessFeedback: this.mapFeedbackRows(this.successFeedbackRows),
      videoRetryFeedback: this.mapFeedbackRows(this.retryFeedbackRows)
    };

    this.exerciseService.createExercise(payload).subscribe({
      next: () => {
        this.saving = false;
        this.snackBar.open('Video exercise created!', '', { duration: 2500, panelClass: ['success-snack'] });
        setTimeout(() => this.router.navigate(['/admin/digital-exercises']), 1200);
      },
      error: (err) => {
        this.saving = false;
        this.snackBar.open(err.error?.error || 'Failed to save', 'Close', { duration: 4000, panelClass: ['error-snack'] });
      }
    });
  }

  cancel(): void {
    this.router.navigate(['/admin/digital-exercises']);
  }
}
