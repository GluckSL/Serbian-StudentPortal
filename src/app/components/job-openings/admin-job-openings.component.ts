import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { QuillModule } from 'ngx-quill';
import {
  JobApplicationRecord,
  JobClosedListing,
  JobOpening,
  JobOpeningService,
  JobPlacementHighlight,
  JobPortalSettings,
  JobPortalStats,
  JobType,
  LocationType
} from '../../services/job-opening.service';

export type AdminJobTab = 'openings' | 'closed' | 'placements';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-admin-job-openings',
  standalone: true,
  imports: [CommonModule, FormsModule, QuillModule],
  templateUrl: './admin-job-openings.component.html',
  styleUrls: ['./job-portal-theme.css', './admin-job-openings.component.css']
})
export class AdminJobOpeningsComponent implements OnInit {
  adminTab: AdminJobTab = 'openings';
  loading = true;
  saving = false;
  openings: JobOpening[] = [];

  closedLoading = false;
  closedList: JobClosedListing[] = [];
  closedLoaded = false;
  showClosedForm = false;
  editingClosedId = '';
  savingClosed = false;
  closedLogoFile: File | null = null;
  closedLogoPreview = '';
  closedForm = {
    companyName: '',
    companyLogoUrl: '',
    jobTitle: '',
    jobType: 'Full Time' as JobType,
    experience: '',
    location: '',
    salary: '',
    skillsText: '',
    closedAt: '',
    note: '',
    isPublished: true
  };

  placementsLoading = false;
  placementsList: JobPlacementHighlight[] = [];
  placementsLoaded = false;
  showPlacementForm = false;
  editingPlacementId = '';
  savingPlacement = false;
  placementLogoFile: File | null = null;
  placementLogoPreview = '';
  placementForm = {
    studentName: '',
    studentRegNo: '',
    batch: '',
    companyName: '',
    companyLogoUrl: '',
    jobTitle: '',
    placedAt: '',
    packageLabel: '',
    story: '',
    isPublished: true
  };
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
    minJourneyDay: '' as string | number,
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
    this.loadOpenings();
    this.loadPortalSettings();
  }

  setAdminTab(tab: AdminJobTab): void {
    this.adminTab = tab;
    if (tab === 'closed' && !this.closedLoaded) this.loadClosed();
    if (tab === 'placements' && !this.placementsLoaded) this.loadPlacements();
  }

  loadOpenings(): void {
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
  }

  loadPortalSettings(): void {
    this.jobService.getPortalSettingsAdmin().subscribe({
      next: (res) => {
        this.portalSettings = { ...this.portalSettings, ...(res?.data?.settings || {}) };
        this.stats = res?.data?.stats || null;
      }
    });
  }

  load(): void {
    this.loadOpenings();
  }

  loadClosed(): void {
    this.closedLoading = true;
    this.jobService.getAdminClosed().subscribe({
      next: (res) => {
        this.closedList = res?.data || [];
        this.closedLoaded = true;
        this.closedLoading = false;
      },
      error: () => {
        this.closedList = [];
        this.closedLoading = false;
        this.notify.error('Failed to load closed jobs.');
      }
    });
  }

  loadPlacements(): void {
    this.placementsLoading = true;
    this.jobService.getAdminPlacements().subscribe({
      next: (res) => {
        this.placementsList = res?.data || [];
        this.placementsLoaded = true;
        this.placementsLoading = false;
      },
      error: () => {
        this.placementsList = [];
        this.placementsLoading = false;
        this.notify.error('Failed to load placements.');
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
      minJourneyDay: '',
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
      minJourneyDay: job.minJourneyDay != null ? job.minJourneyDay : '',
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
    const minJd = String(this.form.minJourneyDay ?? '').trim();
    fd.append('minJourneyDay', minJd);
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

  toDatetimeLocal(dateStr: string): string {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  openClosedCreate(): void {
    this.editingClosedId = '';
    this.closedLogoFile = null;
    this.closedLogoPreview = '';
    this.closedForm = {
      companyName: '',
      companyLogoUrl: '',
      jobTitle: '',
      jobType: 'Full Time',
      experience: '',
      location: '',
      salary: '',
      skillsText: '',
      closedAt: '',
      note: '',
      isPublished: true
    };
    this.showClosedForm = true;
  }

  openClosedEdit(row: JobClosedListing): void {
    this.editingClosedId = row._id;
    this.closedLogoFile = null;
    this.closedLogoPreview = this.resolveLogoUrl(row.companyLogoUrl);
    this.closedForm = {
      companyName: row.companyName,
      companyLogoUrl: row.companyLogoUrl || '',
      jobTitle: row.jobTitle,
      jobType: row.jobType,
      experience: row.experience || '',
      location: row.location || '',
      salary: row.salary || '',
      skillsText: (row.skills || []).join(', '),
      closedAt: this.toDatetimeLocal(row.closedAt),
      note: row.note || '',
      isPublished: row.isPublished !== false
    };
    this.showClosedForm = true;
  }

  closeClosedForm(): void {
    this.showClosedForm = false;
    this.editingClosedId = '';
    this.closedLogoFile = null;
    this.closedLogoPreview = '';
  }

  onClosedLogoSelected(event: Event): void {
    this.onLogoSelected(event, 'closed');
  }

  onPlacementLogoSelected(event: Event): void {
    this.onLogoSelected(event, 'placement');
  }

  onLogoSelected(event: Event, target: 'main' | 'closed' | 'placement' = 'main'): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > this.logoMaxBytes) {
      this.notify.error('Logo must be under 5 MB.');
      input.value = '';
      return;
    }
    const preview = URL.createObjectURL(file);
    if (target === 'closed') {
      this.closedLogoFile = file;
      this.closedLogoPreview = preview;
    } else if (target === 'placement') {
      this.placementLogoFile = file;
      this.placementLogoPreview = preview;
    } else {
      this.logoFile = file;
      this.logoPreview = preview;
    }
  }

  buildClosedFormData(): FormData {
    const fd = new FormData();
    fd.append('companyName', this.closedForm.companyName.trim());
    fd.append('jobTitle', this.closedForm.jobTitle.trim());
    fd.append('jobType', this.closedForm.jobType);
    fd.append('experience', this.closedForm.experience.trim());
    fd.append('location', this.closedForm.location.trim());
    fd.append('salary', this.closedForm.salary.trim());
    fd.append('skills', JSON.stringify(
      this.closedForm.skillsText.split(',').map((s) => s.trim()).filter(Boolean)
    ));
    fd.append('closedAt', this.closedForm.closedAt);
    fd.append('note', this.closedForm.note.trim());
    fd.append('isPublished', String(this.closedForm.isPublished));
    if (this.closedLogoFile) fd.append('companyLogo', this.closedLogoFile);
    else if (this.closedForm.companyLogoUrl) fd.append('companyLogoUrl', this.closedForm.companyLogoUrl.trim());
    return fd;
  }

  saveClosed(): void {
    if (!this.closedForm.companyName.trim() || !this.closedForm.jobTitle.trim()) {
      this.notify.error('Company and job title are required.');
      return;
    }
    if (!this.closedForm.closedAt) {
      this.notify.error('Closed date is required.');
      return;
    }
    this.savingClosed = true;
    const fd = this.buildClosedFormData();
    const req = this.editingClosedId
      ? this.jobService.updateClosed(this.editingClosedId, fd)
      : this.jobService.createClosed(fd);
    req.subscribe({
      next: () => {
        this.savingClosed = false;
        this.notify.success(this.editingClosedId ? 'Closed job updated.' : 'Closed job added.');
        this.closeClosedForm();
        this.loadClosed();
      },
      error: (err) => {
        this.savingClosed = false;
        this.notify.error(err?.error?.message || 'Failed to save closed job.');
      }
    });
  }

  removeClosed(row: JobClosedListing): void {
    if (!confirm(`Delete closed listing "${row.jobTitle}"?`)) return;
    this.jobService.deleteClosed(row._id).subscribe({
      next: () => {
        this.notify.success('Closed job deleted.');
        this.loadClosed();
      },
      error: () => this.notify.error('Failed to delete.')
    });
  }

  openPlacementCreate(): void {
    this.editingPlacementId = '';
    this.placementLogoFile = null;
    this.placementLogoPreview = '';
    this.placementForm = {
      studentName: '',
      studentRegNo: '',
      batch: '',
      companyName: '',
      companyLogoUrl: '',
      jobTitle: '',
      placedAt: '',
      packageLabel: '',
      story: '',
      isPublished: true
    };
    this.showPlacementForm = true;
  }

  openPlacementEdit(row: JobPlacementHighlight): void {
    this.editingPlacementId = row._id;
    this.placementLogoFile = null;
    this.placementLogoPreview = this.resolveLogoUrl(row.companyLogoUrl);
    this.placementForm = {
      studentName: row.studentName,
      studentRegNo: row.studentRegNo || '',
      batch: row.batch || '',
      companyName: row.companyName,
      companyLogoUrl: row.companyLogoUrl || '',
      jobTitle: row.jobTitle,
      placedAt: this.toDatetimeLocal(row.placedAt),
      packageLabel: row.packageLabel || '',
      story: row.story || '',
      isPublished: row.isPublished !== false
    };
    this.showPlacementForm = true;
  }

  closePlacementForm(): void {
    this.showPlacementForm = false;
    this.editingPlacementId = '';
    this.placementLogoFile = null;
    this.placementLogoPreview = '';
  }

  buildPlacementFormData(): FormData {
    const fd = new FormData();
    fd.append('studentName', this.placementForm.studentName.trim());
    fd.append('studentRegNo', this.placementForm.studentRegNo.trim());
    fd.append('batch', this.placementForm.batch.trim());
    fd.append('companyName', this.placementForm.companyName.trim());
    fd.append('jobTitle', this.placementForm.jobTitle.trim());
    fd.append('placedAt', this.placementForm.placedAt);
    fd.append('packageLabel', this.placementForm.packageLabel.trim());
    fd.append('story', this.placementForm.story.trim());
    fd.append('isPublished', String(this.placementForm.isPublished));
    if (this.placementLogoFile) fd.append('companyLogo', this.placementLogoFile);
    else if (this.placementForm.companyLogoUrl) fd.append('companyLogoUrl', this.placementForm.companyLogoUrl.trim());
    return fd;
  }

  savePlacement(): void {
    if (!this.placementForm.studentName.trim() || !this.placementForm.companyName.trim() || !this.placementForm.jobTitle.trim()) {
      this.notify.error('Student name, company, and role are required.');
      return;
    }
    if (!this.placementForm.placedAt) {
      this.notify.error('Placed date is required.');
      return;
    }
    this.savingPlacement = true;
    const fd = this.buildPlacementFormData();
    const req = this.editingPlacementId
      ? this.jobService.updatePlacement(this.editingPlacementId, fd)
      : this.jobService.createPlacement(fd);
    req.subscribe({
      next: () => {
        this.savingPlacement = false;
        this.notify.success(this.editingPlacementId ? 'Placement updated.' : 'Placement added.');
        this.closePlacementForm();
        this.loadPlacements();
      },
      error: (err) => {
        this.savingPlacement = false;
        this.notify.error(err?.error?.message || 'Failed to save placement.');
      }
    });
  }

  removePlacement(row: JobPlacementHighlight): void {
    if (!confirm(`Delete placement for "${row.studentName}"?`)) return;
    this.jobService.deletePlacement(row._id).subscribe({
      next: () => {
        this.notify.success('Placement deleted.');
        this.loadPlacements();
      },
      error: () => this.notify.error('Failed to delete.')
    });
  }

  formatDeadline(dateStr: string): string {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
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
