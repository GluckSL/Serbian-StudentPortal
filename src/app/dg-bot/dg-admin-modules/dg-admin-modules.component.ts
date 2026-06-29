import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { firstValueFrom } from 'rxjs';
import { DgApiService } from '../dg-api.service';
import type { DgModuleSummary } from '../dg-bot.types';

@Component({
  selector: 'app-dg-admin-modules',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatPaginatorModule],
  templateUrl: './dg-admin-modules.component.html',
  styleUrls: ['./dg-admin-modules.component.scss'],
})
export class DgAdminModulesComponent implements OnInit {
  /** 'v2' when this component is used for the DG Bot Modules 2.0 route. */
  moduleVersion: 'v1' | 'v2' = 'v1';

  modules: DgModuleSummary[] = [];
  /** Filter list by title (Learning Modules–style search). */
  listFilter = '';
  /** Match Module Management filter dropdown: all | live | draft */
  statusFilter: 'all' | 'live' | 'draft' = 'all';
  loading = true;
  message: string | null = null;
  /** Row id while PATCH visibility is in flight */
  visibilityBusyId: string | null = null;
  /** Row id while copy-to-v2 is in flight */
  copyingV2Id: string | null = null;

  pageIndex = 0;
  pageSize = 10;
  readonly pageSizeOptions = [5, 10, 25, 50];
  readonly skeletonRows = [0, 1, 2, 3, 4, 5, 6, 7];

  get isV2(): boolean {
    return this.moduleVersion === 'v2';
  }

  get filteredModules(): DgModuleSummary[] {
    let list = this.modules;
    if (this.statusFilter === 'live') {
      list = list.filter((m) => !!m.visibleToStudents);
    } else if (this.statusFilter === 'draft') {
      list = list.filter((m) => !m.visibleToStudents);
    }
    const q = (this.listFilter || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => (m.title || '').toLowerCase().includes(q));
  }

  get pagedFilteredModules(): DgModuleSummary[] {
    const list = this.filteredModules;
    const start = this.pageIndex * this.pageSize;
    return list.slice(start, start + this.pageSize);
  }

  onPageChange(ev: PageEvent): void {
    this.pageIndex = ev.pageIndex;
    this.pageSize = ev.pageSize;
  }

  resetListPage(): void {
    this.pageIndex = 0;
  }

  get dgStatTotal(): number {
    return this.modules.length;
  }

  get dgStatLive(): number {
    return this.modules.filter((m) => !!m.visibleToStudents).length;
  }

  get dgStatDraft(): number {
    return this.modules.filter((m) => !m.visibleToStudents).length;
  }

  get dgStatGerman(): number {
    return this.modules.filter((m) => (m.language || 'German') === 'German').length;
  }

  get dgStatEnglish(): number {
    return this.modules.filter((m) => (m.language || '') === 'English').length;
  }

  /** v2 modules with no batches assigned yet */
  get dgStatUnassigned(): number {
    return this.modules.filter((m) => !m.targetBatches || m.targetBatches.length === 0).length;
  }

  trackModule(_: number, m: DgModuleSummary): string {
    return m._id || m.title || '';
  }

  isBeginnerMode(m: DgModuleSummary): boolean {
    return !!m.beginnerMode?.enabled;
  }

  moduleCategoryLabel(m: DgModuleSummary): string {
    return this.isBeginnerMode(m) ? 'Beginner mode' : 'Guided speaking';
  }

  targetBatchLabels(m: DgModuleSummary): string[] {
    const batches = Array.isArray(m.targetBatches) ? m.targetBatches.filter(Boolean) : [];
    return batches;
  }

  showsAllBatches(m: DgModuleSummary): boolean {
    return this.targetBatchLabels(m).length === 0;
  }

  constructor(
    private dgApi: DgApiService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.route.data.subscribe((data) => {
      if (data['moduleVersion'] === 'v2') {
        this.moduleVersion = 'v2';
      } else {
        this.moduleVersion = 'v1';
      }
    });

    this.route.queryParamMap.subscribe((params) => {
      const status = (params.get('status') || '').toLowerCase();
      if (status === 'all' || status === 'live' || status === 'draft') {
        this.statusFilter = status;
      }
      const savedId = params.get('saved');
      if (savedId) {
        this.message = 'Module saved successfully.';
      }
    });
    this.reload();
  }

  reload(): void {
    this.loading = true;
    firstValueFrom(this.dgApi.listAdminModules(this.moduleVersion))
      .then((m) => {
        this.modules = m.modules || [];
        this.pageIndex = 0;
        this.loading = false;
      })
      .catch((e) => {
        this.message = e?.error?.message || 'Load failed';
        this.loading = false;
      });
  }

  goCreate(): void {
    if (this.isV2) {
      this.router.navigate(['/admin/dg-modules/new'], { queryParams: { moduleVersion: 'v2' } });
    } else {
      this.router.navigate(['/admin/dg-modules/new']);
    }
  }

  goEdit(m: DgModuleSummary): void {
    if (!m._id) return;
    if (this.isV2) {
      this.router.navigate(['/admin/dg-modules', m._id, 'edit'], { queryParams: { moduleVersion: 'v2' } });
    } else {
      this.router.navigate(['/admin/dg-modules', m._id, 'edit']);
    }
  }

  goPreview(m: DgModuleSummary): void {
    if (!m._id) return;
    this.router.navigate(['/dg-bot', m._id, 'play']);
  }

  goAnalytics(m: DgModuleSummary): void {
    if (!m._id) return;
    this.router.navigate(['/admin/dg-modules', m._id, 'analytics']);
  }

  async toggleStudentVisibility(m: DgModuleSummary): Promise<void> {
    const id = m._id;
    if (!id || this.visibilityBusyId) return;
    const next = !m.visibleToStudents;
    this.visibilityBusyId = id;
    this.message = null;
    try {
      const res = await firstValueFrom(this.dgApi.patchModuleVisibility(id, next));
      m.visibleToStudents = res.visibleToStudents ?? next;
      this.message = next
        ? 'Shown to students when their journey day reaches this module\'s day.'
        : 'Hidden from students.';
    } catch (e: any) {
      this.message = e?.error?.message || 'Could not update visibility';
    } finally {
      this.visibilityBusyId = null;
    }
  }

  async copyToV2(m: DgModuleSummary): Promise<void> {
    const id = m._id;
    if (!id || this.copyingV2Id) return;
    this.copyingV2Id = id;
    this.message = null;
    try {
      const res = await firstValueFrom(this.dgApi.copyModuleToV2(id));
      const newId = res?.module?._id;
      this.message = `Copied to DG Bot Modules 2.0. Opening editor…`;
      setTimeout(() => {
        this.router.navigate(['/admin/dg-modules', newId, 'edit'], {
          queryParams: { moduleVersion: 'v2' },
        });
      }, 800);
    } catch (e: any) {
      this.message = e?.error?.message || 'Copy failed';
    } finally {
      this.copyingV2Id = null;
    }
  }

  async archiveModule(m: DgModuleSummary): Promise<void> {
    if (!m._id) return;
    if (!confirm('Archive this DG module?')) return;
    try {
      await firstValueFrom(this.dgApi.deleteModule(m._id));
      this.message = 'Module archived.';
      this.reload();
    } catch (e: any) {
      this.message = e?.error?.message || 'Delete failed';
    }
  }

  switchToV1(): void {
    this.router.navigate(['/admin/dg-modules']);
  }

  switchToV2(): void {
    this.router.navigate(['/admin/dg-modules-v2']);
  }
}
