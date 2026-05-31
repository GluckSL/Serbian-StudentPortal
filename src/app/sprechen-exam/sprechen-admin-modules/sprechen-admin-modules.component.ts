import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { firstValueFrom } from 'rxjs';
import { SprechenApiService } from '../sprechen-api.service';
import type { SprechenExamModuleSummary } from '../sprechen-exam.types';

@Component({
  selector: 'app-sprechen-admin-modules',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatPaginatorModule],
  templateUrl: './sprechen-admin-modules.component.html',
  styleUrls: ['../../dg-bot/dg-admin-modules/dg-admin-modules.component.scss'],
})
export class SprechenAdminModulesComponent implements OnInit {
  modules: SprechenExamModuleSummary[] = [];
  listFilter = '';
  statusFilter: 'all' | 'live' | 'draft' = 'all';
  loading = true;
  message: string | null = null;
  visibilityBusyId: string | null = null;

  pageIndex = 0;
  pageSize = 10;
  readonly pageSizeOptions = [5, 10, 25, 50];
  readonly skeletonRows = [0, 1, 2, 3, 4, 5, 6, 7];

  constructor(
    private api: SprechenApiService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const status = (params.get('status') || '').toLowerCase();
      if (status === 'all' || status === 'live' || status === 'draft') {
        this.statusFilter = status;
      }
      if (params.get('saved')) {
        this.message = 'Module saved successfully.';
      }
    });
    this.reload();
  }

  get filteredModules(): SprechenExamModuleSummary[] {
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

  get pagedFilteredModules(): SprechenExamModuleSummary[] {
    const start = this.pageIndex * this.pageSize;
    return this.filteredModules.slice(start, start + this.pageSize);
  }

  get statTotal(): number {
    return this.modules.length;
  }

  get statLive(): number {
    return this.modules.filter((m) => m.visibleToStudents).length;
  }

  get statDraft(): number {
    return this.modules.filter((m) => !m.visibleToStudents).length;
  }

  onPageChange(ev: PageEvent): void {
    this.pageIndex = ev.pageIndex;
    this.pageSize = ev.pageSize;
  }

  resetListPage(): void {
    this.pageIndex = 0;
  }

  trackModule(_: number, m: SprechenExamModuleSummary): string {
    return m._id;
  }

  reload(): void {
    this.loading = true;
    firstValueFrom(this.api.listAdminModules())
      .then((d) => {
        this.modules = d.modules || [];
        this.pageIndex = 0;
        this.loading = false;
      })
      .catch((e) => {
        this.message = e?.error?.message || 'Load failed';
        this.loading = false;
      });
  }

  goCreate(): void {
    this.router.navigate(['/admin/sprechen-exam/new']);
  }

  goEdit(m: SprechenExamModuleSummary): void {
    this.router.navigate(['/admin/sprechen-exam', m._id, 'edit']);
  }

  goPreview(m: SprechenExamModuleSummary): void {
    this.router.navigate(['/sprechen-exam', m._id, 'play']);
  }

  goAnalytics(m: SprechenExamModuleSummary): void {
    this.router.navigate(['/admin/sprechen-exam', m._id, 'sessions']);
  }

  async toggleStudentVisibility(m: SprechenExamModuleSummary): Promise<void> {
    if (!m._id || this.visibilityBusyId) return;
    const next = !m.visibleToStudents;
    this.visibilityBusyId = m._id;
    this.message = null;
    try {
      const res = await firstValueFrom(this.api.patchVisibility(m._id, next));
      m.visibleToStudents = res.visibleToStudents ?? next;
      this.message = next
        ? 'Shown to students when journey day is reached.'
        : 'Hidden from students.';
    } catch (e: any) {
      this.message = e?.error?.message || 'Could not update visibility';
    } finally {
      this.visibilityBusyId = null;
    }
  }

  async archiveModule(m: SprechenExamModuleSummary): Promise<void> {
    if (!m._id || !confirm(`Archive "${m.title}"?`)) return;
    try {
      await firstValueFrom(this.api.deleteModule(m._id));
      this.message = 'Module archived.';
      this.reload();
    } catch (e: any) {
      this.message = e?.error?.message || 'Delete failed';
    }
  }

  seedPlaceholder(): void {
    firstValueFrom(this.api.seedPlaceholder())
      .then(() => {
        this.message = 'Placeholder module created (Olly Tutor).';
        this.reload();
      })
      .catch((e) => {
        this.message = e?.error?.message || 'Seed failed';
      });
  }
}
