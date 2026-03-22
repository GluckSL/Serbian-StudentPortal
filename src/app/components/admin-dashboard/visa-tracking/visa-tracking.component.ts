import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VisaTrackingService } from '../../../services/visa-tracking.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-visa-tracking',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './visa-tracking.component.html',
  styleUrls: ['./visa-tracking.component.css']
})
export class VisaTrackingComponent implements OnInit {
  records: any[] = [];
  students: any[] = [];
  portalStages: any[] = [];
  auPairStages: any[] = [];
  isLoading = true;

  showForm = false;
  editingRecord: any = null;
  form: any = {
    studentId: '', visaType: 'PORTAL',
    stages: [] as any[],
    finalOutcome: '', finalOutcomeNote: '', adminNotes: ''
  };

  searchTerm = '';
  historyRecord: any = null;
  studentSearch = '';
  studentDropdownOpen = false;

  constructor(private visaSvc: VisaTrackingService, private http: HttpClient) {}

  ngOnInit(): void { this.loadData(); }

  loadData(): void {
    this.isLoading = true;
    this.visaSvc.getStages().subscribe({
      next: (res) => {
        this.portalStages = res.portal;
        this.auPairStages = res.auPair;
        this.loadRecordsAndStudents();
      },
      error: () => {
        // If stages fail, still try to load records with fallback stage defs
        this.portalStages = [
          { stage: 1, label: 'Application Filed', desc: 'Portal submission completed', dateLabel: 'Portal Submission Date' },
          { stage: 2, label: 'Preliminary Review', desc: 'Submitted & under preliminary review', dateLabel: '' },
          { stage: 3, label: 'Embassy Review', desc: 'With embassy/consulate – under review', dateLabel: 'Embassy Submission Date' },
          { stage: 4, label: 'Embassy Feedback', desc: 'Embassy feedback: changes or pre-approved', dateLabel: '' },
          { stage: 5, label: 'Changes / Appointment', desc: 'Working on changes or appointment booking', dateLabel: 'Appointment Date' },
          { stage: 6, label: 'Final Submission & Decision', desc: 'Interview, biometrics & visa decision', dateLabel: 'Decision Date' }
        ];
        this.auPairStages = [
          { stage: 1, label: 'Appointment Booking', desc: 'Embassy appointment booking', dateLabel: 'Appointment Date' },
          { stage: 2, label: 'Document Preparation', desc: 'Collecting & organising documents', dateLabel: '' },
          { stage: 3, label: 'Interview Preparation', desc: 'Mock interviews & training', dateLabel: '' },
          { stage: 4, label: 'Embassy Visit', desc: 'Embassy/VFS submission & interview', dateLabel: 'Embassy Visit Date' },
          { stage: 5, label: 'Result & Next Steps', desc: 'Waiting for decision & next steps', dateLabel: 'Decision Date' }
        ];
        this.loadRecordsAndStudents();
      }
    });
  }

  private loadRecordsAndStudents(): void {
    this.http.get<any>(`${environment.apiUrl}/admin/students`, { withCredentials: true }).subscribe({
      next: (res) => { this.students = res.data || []; },
      error: () => { this.students = []; }
    });
    this.visaSvc.getAll().subscribe({
      next: (res) => { this.records = res.data || []; this.isLoading = false; },
      error: () => { this.records = []; this.isLoading = false; }
    });
  }

  get stageDefs(): any[] {
    return this.form.visaType === 'AU_PAIR' ? this.auPairStages : this.portalStages;
  }

  stageDefsFor(record: any): any[] {
    return record.visaType === 'AU_PAIR' ? this.auPairStages : this.portalStages;
  }

  get filteredRecords(): any[] {
    if (!this.searchTerm) return this.records;
    const t = this.searchTerm.toLowerCase();
    return this.records.filter((r: any) =>
      r.studentId?.name?.toLowerCase().includes(t) ||
      r.studentId?.regNo?.toLowerCase().includes(t) ||
      r.studentId?.email?.toLowerCase().includes(t)
    );
  }

  get availableStudents(): any[] {
    const existingIds = new Set(this.records.map((r: any) => r.studentId?._id));
    return this.students.filter(s => !existingIds.has(s._id));
  }

  get filteredStudents(): any[] {
    const t = this.studentSearch.toLowerCase().trim();
    const available = this.availableStudents;
    if (!t) return available;
    return available.filter(s =>
      s.name?.toLowerCase().includes(t) || s.regNo?.toLowerCase().includes(t)
    );
  }

  selectStudent(s: any): void {
    this.form.studentId = s._id;
    this.studentSearch = s.name + ' (' + s.regNo + ')';
    this.studentDropdownOpen = false;
  }

  /** A stage is editable if it's stage 1, previous stage is completed, or this stage is rejected (retry) */
  isStageEditable(stg: any): boolean {
    if (stg.stage === 1) return true;
    if (stg.outcome === 'rejected') return true;
    const prev = this.form.stages.find((s: any) => s.stage === stg.stage - 1);
    return prev?.outcome === 'completed';
  }

  /** Computed current stage from form stages */
  get computedCurrentStage(): number {
    for (const s of this.form.stages) {
      if (s.outcome !== 'completed') return s.stage;
    }
    return this.form.stages.length;
  }

  buildEmptyStages(visaType: string): any[] {
    const defs = visaType === 'AU_PAIR' ? this.auPairStages : this.portalStages;
    return defs.map(d => ({
      stage: d.stage, status: '', message: '', actionRequired: false,
      actionNote: '', handledBy: '', outcome: '',
      stageDate: '', stageDateLabel: d.dateLabel || ''
    }));
  }

  openCreate(): void {
    this.editingRecord = null;
    this.studentSearch = '';
    this.studentDropdownOpen = false;
    this.form = {
      studentId: '', visaType: 'PORTAL',
      stages: this.buildEmptyStages('PORTAL'),
      finalOutcome: '', finalOutcomeNote: '', adminNotes: ''
    };
    this.showForm = true;
  }

  onVisaTypeChange(): void {
    this.form.stages = this.buildEmptyStages(this.form.visaType);
  }

  openEdit(record: any): void {
    this.editingRecord = record;
    const defs = record.visaType === 'AU_PAIR' ? this.auPairStages : this.portalStages;
    const stagesData = defs.map((d: any) => {
      const existing = (record.stages || []).find((s: any) => s.stage === d.stage);
      return {
        stage: d.stage,
        status: existing?.status || '',
        message: existing?.message || '',
        actionRequired: existing?.actionRequired || false,
        actionNote: existing?.actionNote || '',
        handledBy: existing?.handledBy || '',
        outcome: existing?.outcome || '',
        stageDate: this.toDateInput(existing?.stageDate),
        stageDateLabel: d.dateLabel || existing?.stageDateLabel || ''
      };
    });
    this.form = {
      studentId: record.studentId?._id || '',
      visaType: record.visaType,
      stages: stagesData,
      finalOutcome: record.finalOutcome || '',
      finalOutcomeNote: record.finalOutcomeNote || '',
      adminNotes: record.adminNotes || ''
    };
    this.showForm = true;
  }

  save(): void {
    const payload = { ...this.form };
    if (this.editingRecord) {
      this.visaSvc.update(this.editingRecord._id, payload).subscribe({
        next: () => { this.showForm = false; this.loadData(); },
        error: (err: any) => { console.error('Save error:', err); alert('Save failed: ' + (err.error?.message || err.message)); }
      });
    } else {
      this.visaSvc.create(payload).subscribe({
        next: () => { this.showForm = false; this.loadData(); },
        error: (err: any) => { console.error('Create error:', err); alert('Create failed: ' + (err.error?.message || err.message)); }
      });
    }
  }

  deleteRecord(record: any): void {
    if (!confirm('Delete visa record for ' + (record.studentId?.name || 'this student') + '?')) return;
    this.visaSvc.delete(record._id).subscribe(() => this.loadData());
  }

  cancel(): void { this.showForm = false; }
  openHistory(record: any): void { this.historyRecord = record; }
  closeHistory(): void { this.historyRecord = null; }

  toDateInput(d: any): string {
    if (!d) return '';
    return new Date(d).toISOString().split('T')[0];
  }

  formatDate(d: any): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  stageLabel(record: any): string {
    const defs = this.stageDefsFor(record);
    const s = defs.find((st: any) => st.stage === record.currentStage);
    return s ? s.label : 'Stage ' + record.currentStage;
  }

  /** Is the last stage completed? Show final outcome section */
  get isLastStageCompleted(): boolean {
    if (!this.form.stages.length) return false;
    const last = this.form.stages[this.form.stages.length - 1];
    return last.outcome === 'completed';
  }
}
