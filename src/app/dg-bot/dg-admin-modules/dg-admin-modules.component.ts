import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DgApiService } from '../dg-api.service';
import type { DgModuleSummary } from '../dg-bot.types';

@Component({
  selector: 'app-dg-admin-modules',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './dg-admin-modules.component.html',
  styleUrls: ['./dg-admin-modules.component.scss'],
})
export class DgAdminModulesComponent implements OnInit {
  modules: DgModuleSummary[] = [];
  /** Filter list by title (Learning Modules–style search). */
  listFilter = '';
  /** Match Module Management filter dropdown: all | live | draft */
  statusFilter: 'all' | 'live' | 'draft' = 'all';
  loading = true;
  message: string | null = null;
  /** Row id while PATCH visibility is in flight */
  visibilityBusyId: string | null = null;

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

  previewDescription(text: string | undefined, max = 72): string {
    const s = (text || '').trim();
    if (!s) return 'No description';
    return s.length > max ? `${s.slice(0, max)}…` : s;
  }

  trackModule(_: number, m: DgModuleSummary): string {
    return m._id || m.title || '';
  }

  constructor(
    private dgApi: DgApiService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
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
    firstValueFrom(this.dgApi.listAdminModules())
      .then((m) => {
        this.modules = m.modules || [];
        this.loading = false;
      })
      .catch((e) => {
        this.message = e?.error?.message || 'Load failed';
        this.loading = false;
      });
  }

  goCreate(): void {
    this.router.navigate(['/admin/dg-modules/new']);
  }

  goEdit(m: DgModuleSummary): void {
    if (!m._id) return;
    this.router.navigate(['/admin/dg-modules', m._id, 'edit']);
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
        ? 'Shown to students when their journey day reaches this module’s day.'
        : 'Hidden from students.';
    } catch (e: any) {
      this.message = e?.error?.message || 'Could not update visibility';
    } finally {
      this.visibilityBusyId = null;
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
}
