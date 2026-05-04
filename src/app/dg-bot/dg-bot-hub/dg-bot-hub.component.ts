import { Component, Input, OnChanges, OnInit, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { map } from 'rxjs/operators';
import { BreakpointObserver } from '@angular/cdk/layout';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MaterialModule } from '../../shared/material.module';
import { AuthService } from '../../services/auth.service';
import { DgApiService } from '../dg-api.service';
import type { DgModuleSummary } from '../dg-bot.types';

type HubTab = 'completed' | 'pending' | 'new';

@Component({
  selector: 'app-dg-bot-hub',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatButtonModule, MatIconModule, MaterialModule],
  templateUrl: './dg-bot-hub.component.html',
  styleUrl: './dg-bot-hub.component.scss',
})
export class DgBotHubComponent implements OnInit, OnChanges {
  /** When true, rendered inside My Course (Talk Buddy tab): compact chrome + no redirect. */
  @Input() embedded = false;

  /**
   * When set (e.g. from Journey to Germany), only modules for this journey `courseDay`
   * are shown, with Completed / Pending / New interpreted for that day.
   */
  @Input() journeyFixedDay: number | null = null;

  /** Hide the Talk Buddy title strip (parent supplies a section heading, e.g. Journey day). */
  @Input() hideEmbeddedHeader = false;

  /** Raw list from API before optional `journeyFixedDay` filter. */
  private allModules: DgModuleSummary[] = [];
  /** Set after first successful load — used for journey-day empty copy. */
  rawModuleCount = 0;

  modules: DgModuleSummary[] = [];
  filteredModules: DgModuleSummary[] = [];
  loading = true;
  error: string | null = null;

  activeTab: HubTab = 'new';
  studentCourseDay = 1;

  searchQuery = '';
  selectedLevel = '';
  selectedLanguage = '';

  currentPage = 1;
  readonly pageSize = 12;
  totalPages = 1;

  searchInputPlaceholder = 'Search modules by title…';

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly dgApi = inject(DgApiService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['journeyFixedDay'] && !changes['journeyFixedDay'].firstChange && this.allModules.length) {
      this.applyDayScope();
    }
  }

  constructor(breakpointObserver: BreakpointObserver) {
    breakpointObserver
      .observe('(max-width: 640px)')
      .pipe(
        map((r) => r.matches),
        takeUntilDestroyed(),
      )
      .subscribe((compact) => {
        this.searchInputPlaceholder = compact ? 'Search…' : 'Search modules by title…';
      });
  }

  ngOnInit(): void {
    const u = this.auth.getSnapshotUser();
    if (!this.embedded && u?.role === 'STUDENT') {
      this.router.navigate(['/student/my-course'], {
        queryParams: { tab: 'talk-buddy' },
        replaceUrl: true,
      });
      return;
    }
    this.loadModules();
  }

  loadModules(): void {
    this.loading = true;
    this.error = null;
    this.dgApi.listStudentModules().subscribe({
      next: (r) => {
        this.allModules = r.modules || [];
        this.rawModuleCount = this.allModules.length;
        const d = Number(r?.studentCourseDay);
        if (Number.isFinite(d) && d >= 1) {
          this.studentCourseDay = Math.min(200, Math.floor(d));
        }
        this.applyDayScope();
        this.loading = false;
      },
      error: (e) => {
        this.error = e?.error?.message || 'Could not load modules';
        this.loading = false;
      },
    });
  }

  setTab(tab: HubTab): void {
    this.activeTab = tab;
    this.currentPage = 1;
    this.applyFilters();
  }

  onSearchInput(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.currentPage = 1;
      this.applyFilters();
    }, 400);
  }

  onFilterChange(): void {
    this.currentPage = 1;
    this.applyFilters();
  }

  clearFilters(): void {
    this.searchQuery = '';
    this.selectedLevel = '';
    this.selectedLanguage = '';
    this.currentPage = 1;
    this.applyFilters();
  }

  hasActiveFilters(): boolean {
    return !!(this.searchQuery.trim() || this.selectedLevel || this.selectedLanguage);
  }

  /** Full filter bar (search + level + language): standalone hub only. */
  showFullFilters(): boolean {
    return this.modules.length > 0 && !this.embedded && this.journeyFixedDay == null;
  }

  /** Talk Buddy tab: title search only (no level / language row). */
  showEmbeddedSearchOnly(): boolean {
    return this.modules.length > 0 && this.embedded && this.journeyFixedDay == null;
  }

  applyDayScope(): void {
    if (this.journeyFixedDay != null && Number.isFinite(Number(this.journeyFixedDay))) {
      const d = Math.min(200, Math.max(1, Math.floor(Number(this.journeyFixedDay))));
      this.modules = this.allModules.filter((m) => this.moduleCourseDayNum(m) === d);
    } else {
      this.modules = [...this.allModules];
    }
    this.applyFilters();
  }

  private applyFilters(): void {
    const q = this.searchQuery.trim().toLowerCase();
    let list = this.modules.filter((m) => this.matchesStudentTab(m, this.activeTab));

    if (q) {
      list = list.filter((m) => {
        const title = (m.title || '').toLowerCase();
        const desc = (m.description || '').toLowerCase();
        return title.includes(q) || desc.includes(q);
      });
    }
    if (this.selectedLevel) {
      list = list.filter((m) => (m.level || '').toUpperCase() === this.selectedLevel.toUpperCase());
    }
    if (this.selectedLanguage) {
      list = list.filter(
        (m) =>
          (m.language || '').toLowerCase() === this.selectedLanguage.toLowerCase() ||
          (m.nativeLanguage || '').toLowerCase() === this.selectedLanguage.toLowerCase(),
      );
    }

    this.filteredModules = list;
    this.totalPages = Math.max(1, Math.ceil(list.length / this.pageSize));
    if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
  }

  get paginatedModules(): DgModuleSummary[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredModules.slice(start, start + this.pageSize);
  }

  changePage(page: number): void {
    this.currentPage = page;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  getPageNumbers(): number[] {
    const pages: number[] = [];
    const start = Math.max(1, this.currentPage - 2);
    const end = Math.min(this.totalPages, this.currentPage + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }

  get journeyWeekHint(): string {
    const a = this.studentCourseDay;
    const b = Math.min(200, a + 6);
    return `Journey days ${a}–${b}: “New” is tied to your current journey day.`;
  }

  get levelOptions(): string[] {
    const set = new Set<string>();
    for (const m of this.modules) {
      const lv = (m.level || '').trim();
      if (lv) set.add(lv.toUpperCase());
    }
    return [...set].sort();
  }

  get languageOptions(): string[] {
    const set = new Set<string>();
    for (const m of this.modules) {
      const t = (m.language || '').trim();
      const n = (m.nativeLanguage || '').trim();
      if (t) set.add(t);
      if (n) set.add(n);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  moduleCourseDayNum(m: DgModuleSummary): number | null {
    const cd = m.courseDay;
    if (cd == null || cd === undefined) return null;
    const n = Number(cd);
    if (!Number.isFinite(n)) return null;
    return Math.min(200, Math.max(1, Math.floor(n)));
  }

  isModuleCompleted(m: DgModuleSummary): boolean {
    return !!m.studentProgress?.completed;
  }

  /**
   * Same flow as digital exercises (students):
   * - New: assigned journey day === current day, not completed.
   * - Pending: not completed, and not in “new” (past days or no fixed day).
   * - Completed: at least one completed DG session for this module.
   */
  private matchesStudentTab(m: DgModuleSummary, tab: HubTab): boolean {
    const completed = this.isModuleCompleted(m);
    const dayNum = this.moduleCourseDayNum(m);
    const cur = this.studentCourseDay;

    if (this.journeyFixedDay != null) {
      const d = Math.min(200, Math.max(1, Math.floor(Number(this.journeyFixedDay))));
      if (tab === 'completed') {
        return completed;
      }
      if (completed) {
        return false;
      }
      if (tab === 'new') {
        return dayNum != null && dayNum === cur && d === cur;
      }
      return !(dayNum != null && dayNum === cur && d === cur);
    }

    if (tab === 'completed') {
      return completed;
    }
    if (completed) {
      return false;
    }
    if (tab === 'new') {
      return dayNum != null && dayNum === cur;
    }
    if (dayNum != null && dayNum === cur) {
      return false;
    }
    return true;
  }

  journeyDayLabel(m: DgModuleSummary): string {
    const d = this.moduleCourseDayNum(m);
    return d == null ? 'Any day' : `Day ${d}`;
  }

  trackModule = (_: number, m: DgModuleSummary): string => m._id;

  get totalModules(): number {
    return this.modules.length;
  }

  get a1Count(): number {
    return this.modules.filter((m) => (m.level || '').toUpperCase() === 'A1').length;
  }

  get a2Count(): number {
    return this.modules.filter((m) => (m.level || '').toUpperCase() === 'A2').length;
  }

  get b1PlusCount(): number {
    return this.modules.filter((m) => {
      const lvl = (m.level || '').toUpperCase();
      return lvl.startsWith('B') || lvl.startsWith('C');
    }).length;
  }

  get totalScenes(): number {
    return this.modules.reduce((sum, m) => sum + (m.scenes?.length || 0), 0);
  }
}
