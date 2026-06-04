import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { JobOpening, JobOpeningService } from '../../services/job-opening.service';
import { JobApplyFormComponent } from './job-apply-form.component';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-student-job-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, JobApplyFormComponent],
  templateUrl: './student-job-detail.component.html',
  styleUrls: ['./job-portal-theme.css', './student-job-detail.component.css']
})
export class StudentJobDetailComponent implements OnInit {
  loading = true;
  job: JobOpening | null = null;
  applied = false;
  showApplyForm = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private jobService: JobOpeningService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/student/job-openings']);
      return;
    }
    this.jobService.getStudentDetail(id).subscribe({
      next: (res) => {
        this.job = res?.data || null;
        this.applied = !!res?.applied;
        this.loading = false;
        if (!this.job) this.router.navigate(['/student/job-openings']);
      },
      error: () => {
        this.loading = false;
        this.router.navigate(['/student/job-openings']);
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/student/job-openings']);
  }

  logoUrl(): string {
    if (!this.job) return '';
    const url = String(this.job.companyLogoUrl || '').trim();
    if (!url) return '';
    if (url.startsWith('http')) return url;
    const base = environment.apiUrl.replace(/\/api\/?$/, '');
    return `${base}${url.startsWith('/') ? url : `/${url}`}`;
  }

  companyInitial(): string {
    return String(this.job?.companyName || '?').trim().charAt(0).toUpperCase() || '?';
  }

  formatApplyBefore(dateStr: string): string {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  apply(): void {
    if (!this.job || this.applied) return;
    this.showApplyForm = true;
  }

  onApplySubmitted(): void {
    this.applied = true;
    this.showApplyForm = false;
  }

  onApplyClosed(): void {
    this.showApplyForm = false;
  }

  share(): void {
    if (!this.job || !navigator.share) return;
    navigator.share({
      title: `${this.job.companyName} — ${this.job.jobTitle}`,
      url: window.location.href
    }).catch(() => {});
  }

  canShare(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.share;
  }
}
