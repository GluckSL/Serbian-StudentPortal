import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { JobOpening, JobOpeningService } from '../../services/job-opening.service';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-job-apply-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './job-apply-form.component.html',
  styleUrls: ['./job-portal-theme.css', './job-apply-form.component.css']
})
export class JobApplyFormComponent implements OnChanges {
  @Input() job: JobOpening | null = null;
  @Input() open = false;
  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<void>();

  loadingPrefill = false;
  submitting = false;
  resumeFile: File | null = null;

  prefill = {
    name: '',
    email: '',
    regNo: '',
    batch: '',
    phone: '',
    linkedIn: '',
    coverLetter: ''
  };

  constructor(
    private jobService: JobOpeningService,
    private notify: NotificationService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']?.currentValue && this.job) {
      this.loadPrefill();
    }
  }

  loadPrefill(): void {
    this.loadingPrefill = true;
    this.resumeFile = null;
    this.jobService.getApplyPrefill().subscribe({
      next: (res) => {
        const d = res?.data;
        this.prefill = {
          name: d?.name || '',
          email: d?.email || '',
          regNo: d?.regNo || '',
          batch: d?.batch || '',
          phone: d?.phone || '',
          linkedIn: '',
          coverLetter: ''
        };
        this.loadingPrefill = false;
      },
      error: () => {
        this.loadingPrefill = false;
        this.notify.error('Could not load your profile.');
      }
    });
  }

  onResumeSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.resumeFile = input.files?.[0] || null;
  }

  close(): void {
    this.closed.emit();
  }

  submit(): void {
    if (!this.job || this.submitting) return;
    if (!this.prefill.phone.trim()) {
      this.notify.error('Phone number is required.');
      return;
    }
    if (this.prefill.coverLetter.trim().length < 20) {
      this.notify.error('Cover letter must be at least 20 characters.');
      return;
    }
    if (!this.resumeFile) {
      this.notify.error('Please attach your resume (PDF or Word).');
      return;
    }

    const fd = new FormData();
    fd.append('phone', this.prefill.phone.trim());
    fd.append('linkedIn', this.prefill.linkedIn.trim());
    fd.append('coverLetter', this.prefill.coverLetter.trim());
    fd.append('resume', this.resumeFile);

    this.submitting = true;
    this.jobService.submitApplication(this.job._id, fd).subscribe({
      next: () => {
        this.submitting = false;
        this.notify.success('Application submitted successfully.');
        this.submitted.emit();
        this.close();
      },
      error: (err) => {
        this.submitting = false;
        this.notify.error(err?.error?.message || 'Failed to submit application.');
      }
    });
  }
}
