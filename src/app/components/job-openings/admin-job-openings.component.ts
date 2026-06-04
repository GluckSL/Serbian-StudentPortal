import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { QuillModule } from 'ngx-quill';
import {
  JobApplicationRecord,
  JobOpening,
  JobOpeningService,
  JobPortalSettings,
  JobPortalStats,
  JobType,
  LocationType
} from '../../services/job-opening.service';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-admin-job-openings',
  standalone: true,
  imports: [CommonModule, FormsModule, QuillModule],
  templateUrl: './admin-job-openings.component.html',
  styleUrls: ['./job-portal-theme.css', './admin-job-openings.component.css']
})
export class AdminJobOpeningsComponent implements OnInit {
  loading = true;
  saving = false;
  openings: JobOpening[] = [];
  portalSettings: JobPortalSettings = {
    heroTitle: '',
    heroSubtitle: '',
    averagePackageLabel: ''
  };
  stats: JobPortalStats | null = null;

  showForm = false;
  showApplications = false;
  applicationsJob: JobOpening | null = null;
  applications: JobApplicationRecord[] = [];
  applicationsLoading = false;
  editingId = '';
  logoFile: File | null = null;
  logoPreview = '';

  form = {
    companyName: '',
    companyLogoUrl: '',
    jobTitle: '',
    jobType: 'Full Time' as JobType,
    experience: '',
    jobCategory: '',
    locationType: 'Onsite' as LocationType,
    location: '',
    salary: '',
    skillsText: '',
    description: '',
    applyBefore: '',
    isPublished: true,
    isActive: true
  };

  readonly jobTypes: JobType[] = ['Full Time', 'Part Time', 'Internship', 'Contract'];
  readonly locationTypes: LocationType[] = ['Onsite', 'Remote', 'Hybrid'];
  readonly quillModules = {
    toolbar: [
      ['bold', 'italic', 'underline'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ header: [2, 3, false] }],
      ['link', 'clean']
    ]
  };

  constructor(
    private jobService: JobOpeningService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.jobService.getAdminAll().subscribe({
      next: (res) => {
        this.openings = res?.data || [];
        this.loading = false;
      },
      error: () => {
        this.openings = [];
        this.loading = false;
        this.notify.error('Failed to load job openings.');
      }
    });
    this.jobService.getPortalSettingsAdmin().subscribe({
      next: (res) => {
        this.portalSettings = { ...this.portalSettings, ...(res?.data?.settings || {}) };
        this.stats = res?.data?.stats || null;
      }
    });
  }

  savePortalSettings(): void {
    this.jobService.savePortalSettings(this.portalSettings).subscribe({
      next: (res) => {
        this.portalSettings = res?.data?.settings || this.portalSettings;
        this.stats = res?.data?.stats || this.stats;
        this.notify.success('Portal banner updated.');
      },
      error: () => this.notify.error('Failed to save portal settings.')
    });
  }

  openCreate(): void {
    this.editingId = '';
    this.logoFile = null;
    this.logoPreview = '';
    this.form = {
      companyName: '',
      companyLogoUrl: '',
      jobTitle: '',
      jobType: 'Full Time',
      experience: '',
      jobCategory: '',
      locationType: 'Onsite',
      location: '',
      salary: '',
      skillsText: '',
      description: '',
      applyBefore: '',
      isPublished: true,
      isActive: true
    };
    this.showForm = true;
  }

  openEdit(job: JobOpening): void {
    this.editingId = job._id;
    this.logoFile = null;
    this.logoPreview = this.resolveLogoUrl(job.companyLogoUrl);
    const d = job.applyBefore ? new Date(job.applyBefore) : null;
    const applyBefore =
      d && !Number.isNaN(d.getTime())
        ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
        : '';
    this.form = {
      companyName: job.companyName,
      companyLogoUrl: job.companyLogoUrl || '',
      jobTitle: job.jobTitle,
      jobType: job.jobType,
      experience: job.experience || '',
      jobCategory: job.jobCategory || '',
      locationType: job.locationType,
      location: job.location || '',
      salary: job.salary || '',
      skillsText: (job.skills || []).join(', '),
      description: job.description || '',
      applyBefore,
      isPublished: job.isPublished !== false,
      isActive: job.isActive !== false
    };
    this.showForm = true;
  }

  closeForm(): void {
    this.showForm = false;
    this.editingId = '';
    this.logoFile = null;
    this.logoPreview = '';
  }

  readonly logoMaxBytes = 5 * 1024 * 1024;

  onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > this.logoMaxBytes) {
      this.notify.error('Logo must be under 5 MB. Try a smaller image or compress it.');
      input.value = '';
      this.logoFile = null;
      this.logoPreview = '';
      return;
    }
    this.logoFile = file;
    this.logoPreview = URL.createObjectURL(file);
  }

  resolveLogoUrl(url?: string): string {
    return this.jobService.mediaFullUrl(url);
  }

  buildFormData(): FormData {
    const fd = new FormData();
    fd.append('companyName', this.form.companyName.trim());
    fd.append('jobTitle', this.form.jobTitle.trim());
    fd.append('jobType', this.form.jobType);
    fd.append('experience', this.form.experience.trim());
    fd.append('jobCategory', this.form.jobCategory.trim());
    fd.append('locationType', this.form.locationType);
    fd.append('location', this.form.location.trim());
    fd.append('salary', this.form.salary.trim());
    fd.append('skills', JSON.stringify(
      this.form.skillsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    ));
    fd.append('description', this.form.description);
    fd.append('applyBefore', this.form.applyBefore);
    fd.append('isPublished', String(this.form.isPublished));
    fd.append('isActive', String(this.form.isActive));
    if (this.logoFile) {
      fd.append('companyLogo', this.logoFile);
    } else if (this.form.companyLogoUrl) {
      fd.append('companyLogoUrl', this.form.companyLogoUrl.trim());
    }
    return fd;
  }

  save(): void {
    if (!this.form.companyName.trim() || !this.form.jobTitle.trim()) {
      this.notify.error('Company name and job title are required.');
      return;
    }
    if (!this.form.applyBefore) {
      this.notify.error('Apply-before date is required.');
      return;
    }
    this.saving = true;
    const fd = this.buildFormData();
    const req = this.editingId
      ? this.jobService.update(this.editingId, fd)
      : this.jobService.create(fd);

    req.subscribe({
      next: () => {
        this.saving = false;
        this.notify.success(this.editingId ? 'Job opening updated.' : 'Job opening published.');
        this.closeForm();
        this.load();
      },
      error: (err) => {
        this.saving = false;
        const msg =
          err?.error?.message ||
          (err?.status === 413 ? 'Company logo is too large (max 5 MB).' : '') ||
          'Failed to save job opening.';
        this.notify.error(msg);
      }
    });
  }

  remove(job: JobOpening): void {
    if (!confirm(`Delete opening "${job.jobTitle}" at ${job.companyName}?`)) return;
    this.jobService.delete(job._id).subscribe({
      next: () => {
        this.notify.success('Job opening deleted.');
        this.load();
      },
      error: () => this.notify.error('Failed to delete.')
    });
  }

  formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }

  viewApplications(job: JobOpening): void {
    this.applicationsJob = job;
    this.showApplications = true;
    this.applicationsLoading = true;
    this.applications = [];
    this.jobService.getAdminApplications(job._id).subscribe({
      next: (res) => {
        this.applications = res?.data || [];
        this.applicationsLoading = false;
      },
      error: () => {
        this.applicationsLoading = false;
        this.notify.error('Failed to load applications.');
      }
    });
  }

  closeApplications(): void {
    this.showApplications = false;
    this.applicationsJob = null;
    this.applications = [];
  }

  resumeUrl(app: JobApplicationRecord): string {
    return this.jobService.resumeFullUrl(app.resumeUrl);
  }

  applicantName(app: JobApplicationRecord): string {
    return app.studentName || (typeof app.studentId === 'object' ? app.studentId?.name : '') || '—';
  }
}
