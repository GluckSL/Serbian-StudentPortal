import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  canApplyToJob,
  JobOpening,
  JobOpeningService,
  JobType,
  LocationType,
} from '../../services/job-opening.service';
import { NotificationService } from '../../services/notification.service';
import { JobApplyFormComponent } from './job-apply-form.component';

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
  studentJourneyDay = 1;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private jobService: JobOpeningService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/student/job-openings']);
      return;
    }
    this.jobService.getApplyPrefill().subscribe({
      next: (res) => {
        this.studentJourneyDay = res?.data?.journeyDay ?? 1;
      },
      error: () => {}
    });
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

  logoUrl(): string {
    return this.jobService.mediaFullUrl(this.job?.companyLogoUrl);
  }

  companyInitial(): string {
    return String(this.job?.jobTitle || '?').trim().charAt(0).toUpperCase() || '?';
  }

  formatApplyBefore(dateStr: string): string {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('sr-Latn-RS', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  jobTypeLabel(type: JobType): string {
    return {
      'Full Time': 'Puno radno vreme',
      'Part Time': 'Nepuno radno vreme',
      Internship: 'Praksa',
      Contract: 'Ugovor',
    }[type] || type;
  }

  locationTypeLabel(type: LocationType): string {
    return {
      Onsite: 'Na lokaciji',
      Remote: 'Rad na daljinu',
      Hybrid: 'Hibridno',
    }[type] || type;
  }

  apply(): void {
    if (!this.job || this.applied) return;
    if (!canApplyToJob(this.job, this.studentJourneyDay)) {
      this.notify.error(
        this.job.minJourneyDay != null
          ? `Za prijavu je potrebno da dostignete ${this.job.minJourneyDay}. dan programa.`
          : 'Još ne ispunjavate uslove za prijavu.',
      );
      return;
    }
    this.showApplyForm = true;
  }

  onApplySubmitted(): void {
    this.applied = true;
    this.showApplyForm = false;
  }

  onApplyClosed(): void {
    this.showApplyForm = false;
  }
}
