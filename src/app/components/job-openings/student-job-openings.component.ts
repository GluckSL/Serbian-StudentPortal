import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import {
  JobOpening,
  JobOpeningService,
  JobPortalStats,
  JobType,
  LocationType
} from '../../services/job-opening.service';
import { JobApplyFormComponent } from './job-apply-form.component';

@Component({
  selector: 'app-student-job-openings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, JobApplyFormComponent],
  templateUrl: './student-job-openings.component.html',
  styleUrls: ['./job-portal-theme.css', './student-job-openings.component.css']
})
export class StudentJobOpeningsComponent implements OnInit {
  loading = true;
  jobs: JobOpening[] = [];
  stats: JobPortalStats | null = null;
  appliedIds = new Set<string>();

  filterJobType = '';
  filterExperience = '';
  filterCategory = '';
  filterLocationType = '';
  locationSearch = '';
  viewAppliedOnly = false;
  applyJob: JobOpening | null = null;
  showApplyForm = false;

  readonly jobTypes: JobType[] = ['Full Time', 'Part Time', 'Internship', 'Contract'];
  readonly locationTypes: LocationType[] = ['Onsite', 'Remote', 'Hybrid'];

  constructor(
    private jobService: JobOpeningService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.jobService.getForStudent(this.viewAppliedOnly).subscribe({
      next: (res) => {
        this.jobs = res?.data || [];
        this.stats = res?.stats || null;
        this.appliedIds = new Set((res?.appliedIds || []).map(String));
        this.loading = false;
      },
      error: () => {
        this.jobs = [];
        this.loading = false;
      }
    });
  }

  get experienceOptions(): string[] {
    return Array.from(new Set(this.jobs.map((j) => j.experience).filter(Boolean))).sort();
  }

  get categoryOptions(): string[] {
    return Array.from(new Set(this.jobs.map((j) => j.jobCategory).filter(Boolean))).sort();
  }

  get filteredJobs(): JobOpening[] {
    return this.jobs.filter((job) => {
      if (this.filterJobType && job.jobType !== this.filterJobType) return false;
      if (this.filterExperience && job.experience !== this.filterExperience) return false;
      if (this.filterCategory && job.jobCategory !== this.filterCategory) return false;
      if (this.filterLocationType && job.locationType !== this.filterLocationType) return false;
      if (this.locationSearch.trim()) {
        const q = this.locationSearch.trim().toLowerCase();
        if (!String(job.location || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }

  resetFilters(): void {
    this.filterJobType = '';
    this.filterExperience = '';
    this.filterCategory = '';
    this.filterLocationType = '';
    this.locationSearch = '';
  }

  onAppliedToggle(): void {
    this.load();
  }

  logoUrl(job: JobOpening): string {
    return this.jobService.mediaFullUrl(job.companyLogoUrl);
  }

  companyInitial(name: string): string {
    return String(name || '?').trim().charAt(0).toUpperCase() || '?';
  }

  isApplied(job: JobOpening): boolean {
    return this.appliedIds.has(String(job._id));
  }

  openDetail(job: JobOpening): void {
    this.router.navigate(['/student/job-openings', job._id]);
  }

  apply(job: JobOpening, event: Event): void {
    event.stopPropagation();
    if (this.isApplied(job)) return;
    this.applyJob = job;
    this.showApplyForm = true;
  }

  onApplySubmitted(): void {
    if (this.applyJob) this.appliedIds.add(String(this.applyJob._id));
    this.showApplyForm = false;
    this.applyJob = null;
  }

  onApplyClosed(): void {
    this.showApplyForm = false;
    this.applyJob = null;
  }

  formatApplyBefore(dateStr: string): string {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
