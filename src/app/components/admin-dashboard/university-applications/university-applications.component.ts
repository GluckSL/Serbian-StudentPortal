import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { PageEvent } from '@angular/material/paginator';
import { MaterialModule } from '../../../shared/material.module';
import {
  UniversityApplication,
  UniversityApplicationService,
  UniversityApplicationStage,
  UniversityStageDefinition
} from '../../../services/university-application.service';
import { StudentDocumentsService } from '../../../services/student-documents.service';
import { NotificationService } from '../../../services/notification.service';
import { EMPTY, expand, reduce } from 'rxjs';

interface ApplicationForm {
  universityName: string;
  course: string;
  degreeLevel: string;
  country: string;
  city: string;
  campus: string;
  intakeTerm: string;
  applicationReference: string;
  website: string;
  languageOfInstruction: string;
  duration: string;
  tuitionFee: string;
  notes: string;
  stages: UniversityApplicationStage[];
  finalOutcome: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  adminNotes: string;
}

interface StudentAppSummary {
  count: number;
  latestPhase: number;
  phaseLabel: string;
  outcome: string;
  universityName: string;
}

@Component({
  selector: 'app-university-applications',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MaterialModule],
  templateUrl: './university-applications.component.html',
  styleUrls: ['./university-applications.component.css']
})
export class UniversityApplicationsComponent implements OnInit {
  stageDefinitions: UniversityStageDefinition[] = [];
  students: any[] = [];
  allApplications: UniversityApplication[] = [];
  applications: UniversityApplication[] = [];
  applicationsByStudent = new Map<string, UniversityApplication[]>();

  studentsLoading = true;
  appsLoading = true;
  isLoadingApps = false;
  saving = false;

  filterSearch = '';
  filterBatch = 'ALL';
  filterStatus = 'ALL';

  pageSize = 30;
  pageIndex = 0;
  batchOptions: string[] = [];

  selectedStudent: any = null;
  showForm = false;
  editingApplication: UniversityApplication | null = null;
  form: ApplicationForm = this.emptyForm();

  readonly degreeLevels = ['Bachelor', 'Master', 'PhD', 'Diploma', 'Other'];
  readonly finalOutcomes: ApplicationForm['finalOutcome'][] = ['pending', 'accepted', 'rejected', 'withdrawn'];
  readonly statusFilters = [
    { value: 'ALL', label: 'All Students', icon: 'groups' },
    { value: 'NONE', label: 'No Application', icon: 'person_off' },
    { value: 'IN_PROGRESS', label: 'In Progress', icon: 'hourglass_top' },
    { value: 'ACCEPTED', label: 'Accepted', icon: 'check_circle' },
    { value: 'REJECTED', label: 'Rejected', icon: 'cancel' },
    { value: 'WITHDRAWN', label: 'Withdrawn', icon: 'remove_circle' }
  ];

  readonly stageIcons = ['send', 'search', 'verified', 'mail', 'school'];
  readonly stageColors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#005b96'];

  constructor(
    private uniService: UniversityApplicationService,
    private documentService: StudentDocumentsService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadStages();
    this.loadStudents();
    this.loadAllApplications();
  }

  get stats() {
    const withApps = this.students.filter(s => this.getStudentSummary(s._id).count > 0).length;
    const inProgress = this.allApplications.filter(a => !a.finalOutcome || a.finalOutcome === 'pending').length;
    const accepted = this.allApplications.filter(a => a.finalOutcome === 'accepted').length;
    return {
      totalStudents: this.students.length,
      withApplications: withApps,
      inProgress,
      accepted
    };
  }

  get filteredStudents(): any[] {
    let list = [...this.students];
    const q = this.filterSearch.trim().toLowerCase();

    if (q) {
      list = list.filter(s => {
        const name = (s.name || '').toLowerCase();
        const email = (s.email || '').toLowerCase();
        const regNo = (s.regNo || '').toLowerCase();
        return name.includes(q) || email.includes(q) || regNo.includes(q);
      });
    }

    if (this.filterBatch !== 'ALL') {
      list = list.filter(s => (s.batch || '') === this.filterBatch);
    }

    if (this.filterStatus !== 'ALL') {
      list = list.filter(s => {
        const summary = this.getStudentSummary(s._id);
        switch (this.filterStatus) {
          case 'NONE': return summary.count === 0;
          case 'IN_PROGRESS': return summary.count > 0 && summary.outcome === 'pending';
          case 'ACCEPTED': return summary.outcome === 'accepted';
          case 'REJECTED': return summary.outcome === 'rejected';
          case 'WITHDRAWN': return summary.outcome === 'withdrawn';
          default: return true;
        }
      });
    }

    return list;
  }

  get paginatedStudents(): any[] {
    const start = this.pageIndex * this.pageSize;
    return this.filteredStudents.slice(start, start + this.pageSize);
  }

  get totalFiltered(): number {
    return this.filteredStudents.length;
  }

  private emptyForm(): ApplicationForm {
    return {
      universityName: '',
      course: '',
      degreeLevel: '',
      country: '',
      city: '',
      campus: '',
      intakeTerm: '',
      applicationReference: '',
      website: '',
      languageOfInstruction: '',
      duration: '',
      tuitionFee: '',
      notes: '',
      stages: this.buildDefaultStages(),
      finalOutcome: 'pending',
      adminNotes: ''
    };
  }

  private buildDefaultStages(): UniversityApplicationStage[] {
    const defs = this.stageDefinitions.length ? this.stageDefinitions : [
      { stage: 1, label: 'Applied', desc: '' },
      { stage: 2, label: 'In Review', desc: '' },
      { stage: 3, label: 'Approved', desc: '' },
      { stage: 4, label: 'Offer Letter Sent', desc: '' },
      { stage: 5, label: 'Enrolled', desc: '' }
    ];
    return defs.map(d => ({
      stage: d.stage,
      status: 'pending' as const,
      message: '',
      stageDate: null,
      updatedAt: null
    }));
  }

  loadStages(): void {
    this.uniService.getStages().subscribe({
      next: (res) => {
        this.stageDefinitions = res.data || [];
        if (!this.showForm) this.form.stages = this.buildDefaultStages();
      },
      error: () => {
        this.stageDefinitions = [
          { stage: 1, label: 'Applied', desc: 'Application submitted to university' },
          { stage: 2, label: 'In Review', desc: 'University reviewing documents' },
          { stage: 3, label: 'Approved', desc: 'Admission approved or conditional offer' },
          { stage: 4, label: 'Offer Letter Sent', desc: 'Formal offer letter issued' },
          { stage: 5, label: 'Enrolled', desc: 'Student confirmed enrollment' }
        ];
      }
    });
  }

  loadStudents(): void {
    this.studentsLoading = true;
    const pageSize = 100;
    this.documentService.getAllStudents({ page: 1, limit: pageSize }).pipe(
      expand((resp: any) => {
        if (!resp?.success) return EMPTY;
        const pagination = resp?.pagination;
        const page = Number(pagination?.page || 1);
        const totalPages = Number(pagination?.totalPages || pagination?.pages || 1);
        if (page >= totalPages) return EMPTY;
        return this.documentService.getAllStudents({ page: page + 1, limit: pageSize });
      }),
      reduce((acc: any[], resp: any) => {
        if (resp?.success && Array.isArray(resp.data)) return acc.concat(resp.data);
        return acc;
      }, [])
    ).subscribe({
      next: (students) => {
        this.students = students;
        const batches = new Set<string>();
        students.forEach((s: any) => { if (s.batch) batches.add(s.batch); });
        this.batchOptions = Array.from(batches).sort();
        this.studentsLoading = false;
      },
      error: () => {
        this.students = [];
        this.studentsLoading = false;
      }
    });
  }

  loadAllApplications(): void {
    this.appsLoading = true;
    this.uniService.getAllAdmin().subscribe({
      next: (res) => {
        this.allApplications = res.data || [];
        this.rebuildApplicationsMap();
        this.appsLoading = false;
      },
      error: () => {
        this.allApplications = [];
        this.applicationsByStudent.clear();
        this.appsLoading = false;
      }
    });
  }

  private rebuildApplicationsMap(): void {
    this.applicationsByStudent.clear();
    for (const app of this.allApplications) {
      const sid = typeof app.studentId === 'object'
        ? (app.studentId as any)?._id
        : app.studentId;
      if (!sid) continue;
      const key = String(sid);
      if (!this.applicationsByStudent.has(key)) {
        this.applicationsByStudent.set(key, []);
      }
      this.applicationsByStudent.get(key)!.push(app);
    }
  }

  getStudentSummary(studentId: string): StudentAppSummary {
    const apps = [...(this.applicationsByStudent.get(String(studentId)) || [])]
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
    if (!apps.length) {
      return { count: 0, latestPhase: 0, phaseLabel: '—', outcome: 'none', universityName: '—' };
    }
    const latest = apps[0];
    const idx = (latest.currentStage || 1) - 1;
    const defs = latest.stageDefinitions || this.stageDefinitions;
    return {
      count: apps.length,
      latestPhase: latest.currentStage || 1,
      phaseLabel: defs[idx]?.label || `Stage ${latest.currentStage}`,
      outcome: latest.finalOutcome || 'pending',
      universityName: latest.universityName
    };
  }

  onFilterChange(): void {
    this.pageIndex = 0;
  }

  clearFilters(): void {
    this.filterSearch = '';
    this.filterBatch = 'ALL';
    this.filterStatus = 'ALL';
    this.pageIndex = 0;
  }

  onPageChange(event: PageEvent): void {
    this.pageIndex = event.pageIndex;
    this.pageSize = event.pageSize;
  }

  selectStudent(student: any): void {
    this.selectedStudent = student;
    this.loadApplicationsForStudent(student._id);
    setTimeout(() => {
      document.getElementById('student-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  clearStudent(): void {
    this.selectedStudent = null;
    this.applications = [];
    this.closeForm();
  }

  isSelected(student: any): boolean {
    return this.selectedStudent?._id === student?._id;
  }

  loadApplicationsForStudent(studentId: string): void {
    this.isLoadingApps = true;
    this.uniService.getByStudent(studentId).subscribe({
      next: (res) => {
        this.applications = res.data || [];
        this.isLoadingApps = false;
      },
      error: () => {
        this.applications = [];
        this.isLoadingApps = false;
        this.notify.error('Failed to load university applications');
      }
    });
  }

  openCreate(): void {
    if (!this.selectedStudent) {
      this.notify.error('Please select a student first');
      return;
    }
    this.editingApplication = null;
    this.form = this.emptyForm();
    this.showForm = true;
  }

  openEdit(app: UniversityApplication): void {
    this.editingApplication = app;
    this.form = {
      universityName: app.universityName || '',
      course: app.course || '',
      degreeLevel: app.degreeLevel || '',
      country: app.country || '',
      city: app.city || '',
      campus: app.campus || '',
      intakeTerm: app.intakeTerm || '',
      applicationReference: app.applicationReference || '',
      website: app.website || '',
      languageOfInstruction: app.languageOfInstruction || '',
      duration: app.duration || '',
      tuitionFee: app.tuitionFee || '',
      notes: app.notes || '',
      stages: (app.stages || []).map(s => ({ ...s })),
      finalOutcome: app.finalOutcome || 'pending',
      adminNotes: app.adminNotes || ''
    };
    if (!this.form.stages.length) this.form.stages = this.buildDefaultStages();
    this.showForm = true;
  }

  closeForm(): void {
    this.showForm = false;
    this.editingApplication = null;
    this.form = this.emptyForm();
  }

  saveApplication(): void {
    if (!this.selectedStudent) return;
    if (!this.form.universityName.trim()) {
      this.notify.error('University name is required');
      return;
    }

    this.saving = true;
    const payload = { ...this.form };
    const req = this.editingApplication
      ? this.uniService.update(this.editingApplication._id, payload)
      : this.uniService.createForStudent(this.selectedStudent._id, payload);

    req.subscribe({
      next: () => {
        this.saving = false;
        this.notify.success(this.editingApplication ? 'Application updated' : 'Application created');
        this.closeForm();
        this.loadApplicationsForStudent(this.selectedStudent._id);
        this.loadAllApplications();
      },
      error: (err) => {
        this.saving = false;
        this.notify.error(err?.error?.message || 'Failed to save application');
      }
    });
  }

  deleteApplication(app: UniversityApplication): void {
    if (!confirm(`Delete application for ${app.universityName}?`)) return;
    this.uniService.delete(app._id).subscribe({
      next: () => {
        this.notify.success('Application deleted');
        if (this.selectedStudent) {
          this.loadApplicationsForStudent(this.selectedStudent._id);
        }
        this.loadAllApplications();
      },
      error: () => this.notify.error('Failed to delete application')
    });
  }

  stageLabel(app: UniversityApplication): string {
    const idx = (app.currentStage || 1) - 1;
    const defs = app.stageDefinitions || this.stageDefinitions;
    return defs[idx]?.label || `Stage ${app.currentStage}`;
  }

  formatDate(d: string | Date | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  getStageDef(stageNum: number): UniversityStageDefinition | undefined {
    return this.stageDefinitions.find(s => s.stage === stageNum);
  }

  statusLabel(status: string): string {
    if (status === 'in_progress') return 'In Progress';
    if (status === 'completed') return 'Completed';
    return 'Pending';
  }

  outcomeLabel(outcome: string): string {
    if (outcome === 'none') return 'No Application';
    if (outcome === 'pending') return 'In Progress';
    return outcome.charAt(0).toUpperCase() + outcome.slice(1);
  }

  outcomeClass(outcome: string): string {
    if (outcome === 'accepted') return 'ua-outcome--accepted';
    if (outcome === 'rejected') return 'ua-outcome--rejected';
    if (outcome === 'withdrawn') return 'ua-outcome--withdrawn';
    if (outcome === 'pending') return 'ua-outcome--progress';
    return 'ua-outcome--none';
  }

  formProgressPct(): number {
    const completed = this.form.stages.filter(s => s.status === 'completed').length;
    const active = this.form.stages.some(s => s.status === 'in_progress') ? 0.5 : 0;
    return Math.min(100, Math.round(((completed + active) / this.form.stages.length) * 100));
  }

  isStepDone(index: number): boolean {
    return this.form.stages[index]?.status === 'completed';
  }

  isStepActive(index: number): boolean {
    return this.form.stages[index]?.status === 'in_progress';
  }

  onStageDateChange(stg: UniversityApplicationStage, value: string): void {
    stg.stageDate = value ? new Date(value) : null;
  }

  stageDateInputValue(stg: UniversityApplicationStage): string {
    if (!stg.stageDate) return '';
    const d = new Date(stg.stageDate);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }
}
