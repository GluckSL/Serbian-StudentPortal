import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../../../shared/material.module';
import { AuthService } from '../../../services/auth.service';
import { NavService } from '../../../shared/services/nav.service';
import {
  JourneyCrossBatchRecordingAccessService,
  CrossBatchRule,
  CatalogRecording,
  RulePreview,
} from '../../../services/journey-cross-batch-recording-access.service';

@Component({
  selector: 'app-recording-cross-batch-access-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule, RouterModule],
  templateUrl: './recording-cross-batch-access-page.component.html',
  styleUrls: ['./recording-cross-batch-access-page.component.scss'],
})
export class RecordingCrossBatchAccessPageComponent implements OnInit {
  activeBatches: string[] = [];
  batchInput = '';
  savingBatches = false;

  rules: CrossBatchRule[] = [];
  loading = false;
  error = '';

  showForm = false;
  editing: CrossBatchRule | null = null;
  saving = false;
  formError = '';

  form = {
    journeyTitle: '',
    courseDay: '' as number | '',
    targetBatches: [] as string[],
    notes: '',
  };

  previewRuleId: string | null = null;
  preview: RulePreview | null = null;
  previewLoading = false;
  previewError = '';

  mappingJourney: CrossBatchRule | null = null;
  mappingLoading = false;
  mappingSearch = '';
  catalog: CatalogRecording[] = [];
  filteredCatalog: CatalogRecording[] = [];

  canManage = false;
  readonly skeletonRows = Array.from({ length: 5 });

  constructor(
    private service: JourneyCrossBatchRecordingAccessService,
    private authService: AuthService,
    private navService: NavService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.refreshPermissions();
    this.loadActiveBatches();
    this.loadRules();
  }

  private refreshPermissions(): void {
    const user = this.authService.getSnapshotUser();
    const role = String(user?.role || '').toUpperCase();
    if (role === 'ADMIN' || role === 'TEACHER_ADMIN' || role === 'TEACHER') {
      this.canManage = true;
      return;
    }
    if (role === 'SUB_ADMIN') {
      const level = this.navService.getTabAccessLevel(
        'class-recordings',
        user?.sidebarAccessLevels || {},
        user?.sidebarPermissions || []
      );
      this.canManage = this.navService.canAccessLevel(level || undefined, 'edit');
      return;
    }
    this.canManage = false;
  }

  loadActiveBatches(): void {
    this.service.getActiveBatches().subscribe({
      next: (res) => {
        this.activeBatches = res.activeBatches || [];
      },
      error: () => {},
    });
  }

  addBatchFromInput(): void {
    const v = String(this.batchInput || '').trim();
    if (!v) return;
    const exists = this.activeBatches.some((b) => b.toLowerCase() === v.toLowerCase());
    if (!exists) this.activeBatches = [...this.activeBatches, v];
    this.batchInput = '';
  }

  removeActiveBatch(batch: string): void {
    this.activeBatches = this.activeBatches.filter((b) => b !== batch);
    if (this.form.targetBatches.includes(batch)) {
      this.form.targetBatches = this.form.targetBatches.filter((b) => b !== batch);
    }
  }

  saveActiveBatches(): void {
    this.savingBatches = true;
    this.service.updateActiveBatches(this.activeBatches).subscribe({
      next: (res) => {
        this.activeBatches = res.activeBatches || [];
        this.savingBatches = false;
        this.snackBar.open('Active batches updated.', 'Close', { duration: 2500 });
      },
      error: (err) => {
        this.savingBatches = false;
        this.snackBar.open(err?.error?.message || 'Failed to update active batches.', 'Close', { duration: 4000 });
      },
    });
  }

  loadRules(): void {
    this.loading = true;
    this.error = '';
    this.service.getRules().subscribe({
      next: (res) => {
        this.rules = (res.journeys || []).sort((a, b) => Number(a.courseDay || 0) - Number(b.courseDay || 0));
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load rules.';
        this.loading = false;
      },
    });
  }

  openAddForm(): void {
    this.editing = null;
    this.form = {
      journeyTitle: '',
      courseDay: '',
      targetBatches: [...this.activeBatches],
      notes: '',
    };
    this.formError = '';
    this.showForm = true;
  }

  openEditForm(rule: CrossBatchRule): void {
    this.editing = rule;
    this.form = {
      journeyTitle: rule.journeyTitle || '',
      courseDay: rule.courseDay,
      targetBatches: [...(rule.targetBatches || [])],
      notes: rule.notes || '',
    };
    this.formError = '';
    this.showForm = true;
  }

  closeForm(): void {
    this.showForm = false;
    this.editing = null;
    this.formError = '';
  }

  saveRule(): void {
    if (!this.form.courseDay) {
      this.formError = 'Journey day is required.';
      return;
    }
    if (!this.form.targetBatches.length) {
      this.formError = 'Select at least one active batch.';
      return;
    }
    const cd = Number(this.form.courseDay);
    if (!Number.isFinite(cd) || cd < 1 || cd > 200) {
      this.formError = 'Journey day must be between 1 and 200.';
      return;
    }
    this.saving = true;
    this.formError = '';

    const payload = {
      journeyTitle: this.form.journeyTitle.trim(),
      courseDay: cd,
      targetBatches: [...this.form.targetBatches],
      notes: this.form.notes.trim(),
    };

    const req = this.editing
      ? this.service.updateRule(this.editing._id, payload)
      : this.service.createRule(payload);

    req.subscribe({
      next: () => {
        this.saving = false;
        this.closeForm();
        this.snackBar.open(
          this.editing ? 'Journey updated.' : 'Journey created.',
          'Close',
          { duration: 3000 }
        );
        this.loadRules();
      },
      error: (err) => {
        this.saving = false;
        this.formError = err?.error?.message || 'Failed to save rule.';
      },
    });
  }

  toggleActive(rule: CrossBatchRule): void {
    if (!this.canManage) return;
    this.service.updateRule(rule._id, { active: !rule.active }).subscribe({
      next: (res) => {
        rule.active = res.journey.active;
        this.snackBar.open(
          rule.active ? 'Rule activated.' : 'Rule deactivated.',
          'Close',
          { duration: 2500 }
        );
      },
      error: (err) => {
        this.snackBar.open(err?.error?.message || 'Failed to update rule.', 'Close', { duration: 4000 });
      },
    });
  }

  deleteRule(rule: CrossBatchRule): void {
    if (!this.canManage) return;
    if (!confirm(`Delete journey Day ${rule.courseDay}? This cannot be undone.`)) return;
    this.service.deleteRule(rule._id).subscribe({
      next: () => {
        this.snackBar.open('Rule deleted.', 'Close', { duration: 2500 });
        this.loadRules();
        if (this.previewRuleId === rule._id) this.clearPreview();
      },
      error: (err) => {
        this.snackBar.open(err?.error?.message || 'Failed to delete rule.', 'Close', { duration: 4000 });
      },
    });
  }

  loadPreview(rule: CrossBatchRule): void {
    if (this.previewRuleId === rule._id && this.preview) {
      this.clearPreview();
      return;
    }
    this.previewRuleId = rule._id;
    this.preview = null;
    this.previewError = '';
    this.previewLoading = true;
    this.service.previewRule(rule._id).subscribe({
      next: (res) => {
        this.preview = res;
        this.previewLoading = false;
      },
      error: (err) => {
        this.previewError = err?.error?.message || 'Failed to load preview.';
        this.previewLoading = false;
      },
    });
  }

  clearPreview(): void {
    this.previewRuleId = null;
    this.preview = null;
    this.previewError = '';
  }

  isPreviewOpen(rule: CrossBatchRule): boolean {
    return this.previewRuleId === rule._id;
  }

  openMapping(rule: CrossBatchRule): void {
    this.mappingJourney = rule;
    this.mappingSearch = '';
    this.mappingLoading = true;
    this.catalog = [];
    this.filteredCatalog = [];
    this.service.getRecordingsCatalog().subscribe({
      next: (res) => {
        this.catalog = res.recordings || [];
        this.applyCatalogFilter();
        this.mappingLoading = false;
      },
      error: (err) => {
        this.mappingLoading = false;
        this.snackBar.open(err?.error?.message || 'Failed to load recordings catalog.', 'Close', { duration: 4000 });
      },
    });
  }

  closeMapping(): void {
    this.mappingJourney = null;
    this.mappingSearch = '';
    this.catalog = [];
    this.filteredCatalog = [];
  }

  applyCatalogFilter(): void {
    const q = String(this.mappingSearch || '').trim().toLowerCase();
    if (!q) {
      this.filteredCatalog = [...this.catalog];
      return;
    }
    this.filteredCatalog = this.catalog.filter((r) =>
      String(r.title || '').toLowerCase().includes(q) ||
      String(r.courseDay || '').includes(q) ||
      String(r.type || '').includes(q)
    );
  }

  isRecordingMapped(rule: CrossBatchRule, row: CatalogRecording): boolean {
    if (row.type === 'manual') {
      return (rule.mappedManualRecordingIds || []).some((id) => String(id) === String(row.id));
    }
    return (rule.mappedZoomMeetingLinkIds || []).some((id) => String(id) === String(row.id));
  }

  toggleMappedRecording(rule: CrossBatchRule, row: CatalogRecording): void {
    if (!this.canManage) return;
    const mapped = this.isRecordingMapped(rule, row);
    const payload = {
      recordingType: row.type,
      recordingId: row.id,
    };
    const req = mapped
      ? this.service.unmapRecording(rule._id, payload)
      : this.service.mapRecording(rule._id, payload);
    req.subscribe({
      next: (res) => {
        const updated = res.journey;
        rule.mappedManualRecordingIds = updated.mappedManualRecordingIds || [];
        rule.mappedZoomMeetingLinkIds = updated.mappedZoomMeetingLinkIds || [];
      },
      error: (err) => {
        this.snackBar.open(err?.error?.message || 'Failed to update mapped recordings.', 'Close', { duration: 4000 });
      },
    });
  }

  toggleBatchForForm(batch: string): void {
    if (this.form.targetBatches.includes(batch)) {
      this.form.targetBatches = this.form.targetBatches.filter((b) => b !== batch);
      return;
    }
    this.form.targetBatches = [...this.form.targetBatches, batch];
  }

  get activeRulesCount(): number {
    return this.rules.filter((r) => r.active).length;
  }

  get inactiveRulesCount(): number {
    return this.rules.filter((r) => !r.active).length;
  }

  formatBatchLabel(batch: string): string {
    const t = String(batch || '').trim();
    if (!t) return '—';
    if (/^batch\s/i.test(t)) return t;
    return `Batch ${t}`;
  }

  formatBatchList(batches: string[]): string {
    if (!Array.isArray(batches) || !batches.length) return 'None selected';
    return batches.map((b) => this.formatBatchLabel(b)).join(', ');
  }

  attendedPercent(rule: CrossBatchRule): number {
    if (!this.preview || this.previewRuleId !== rule._id || !this.preview.totalStudents) return 0;
    return Math.round((this.preview.attendedCount / this.preview.totalStudents) * 100);
  }

  formatDate(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  journeyCardTitle(rule: CrossBatchRule): string {
    const title = String(rule.journeyTitle || '').trim();
    if (title) return title;
    return `Journey Day ${rule.courseDay}`;
  }
}
