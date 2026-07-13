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
import { clampJourneyDay } from '../../utils/journey-day.util';

type HubTab = 'completed' | 'pending' | 'new' | 'all';

@Component({
  selector: 'app-dg-bot-hub',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatButtonModule, MatIconModule, MaterialModule],
  templateUrl: './dg-bot-hub.component.html',
  styleUrl: './dg-bot-hub.component.scss',
})
export class DgBotHubComponent implements OnInit, OnChanges {
  /** When true, rendered inside My Course (Gluck Buddy tab): compact chrome + no redirect. */
  @Input() embedded = false;

  /**
   * When set (e.g. from Journey to Germany), only modules for this journey `courseDay`
   * are shown, with Completed / Pending / New interpreted for that day.
   */
  @Input() journeyFixedDay: number | null = null;

  /** Hide the Gluck Buddy title strip (parent supplies a section heading, e.g. Journey day). */
  @Input() hideEmbeddedHeader = false;

  /**
   * Pre-loaded modules + metadata from a parent that already called
   * `listStudentModules()`. When provided, the component skips its own API
   * call in `ngOnInit` and uses these values directly.
   */
  @Input() preloadedData: {
    modules: DgModuleSummary[];
    studentCourseDay?: number;
    unlockMode?: 'daily' | 'weekly' | 'none';
    dgUnlockedWeek?: number;
    dgWeekHint?: string | null;
  } | null = null;

  /** Raw list from API before optional `journeyFixedDay` filter. */
  private allModules: DgModuleSummary[] = [];
  /** Set after first successful load — used for journey-day empty copy. */
  rawModuleCount = 0;

  modules: DgModuleSummary[] = [];
  filteredModules: DgModuleSummary[] = [];
  loading = true;
  error: string | null = null;

  activeTab: HubTab = 'all';
  studentCourseDay = 1;
  unlockMode: 'daily' | 'weekly' | 'none' = 'daily';
  dgUnlockedWeek = 1;
  apiWeekHint: string | null = null;

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
    if (this.embedded) {
      this.activeTab = 'new';
    }
    const u = this.auth.getSnapshotUser();
    if (!this.embedded && u?.role === 'STUDENT') {
      this.router.navigate(['/student/my-course'], {
        queryParams: { tab: 'talk-buddy' },
        replaceUrl: true,
      });
      return;
    }
    if (this.preloadedData) {
      this.allModules = this.preloadedData.modules || [];
      this.rawModuleCount = this.allModules.length;
      const d = Number(this.preloadedData?.studentCourseDay);
      if (Number.isFinite(d) && d >= 1) {
        this.studentCourseDay = Math.min(200, Math.floor(d));
      }
      this.unlockMode = this.preloadedData?.unlockMode === 'weekly' ? 'weekly' : this.preloadedData?.unlockMode === 'none' ? 'none' : 'daily';
      const w = Number(this.preloadedData?.dgUnlockedWeek);
      if (Number.isFinite(w) && w >= 1) {
        this.dgUnlockedWeek = Math.floor(w);
      }
      this.apiWeekHint = this.preloadedData?.dgWeekHint?.trim() || null;
      this.loading = false;
      this.applyDayScope();
    } else {
      this.loadModules();
    }
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
        this.unlockMode = r?.unlockMode === 'weekly' ? 'weekly' : r?.unlockMode === 'none' ? 'none' : 'daily';
        const w = Number(r?.dgUnlockedWeek);
        if (Number.isFinite(w) && w >= 1) {
          this.dgUnlockedWeek = Math.floor(w);
        }
        this.apiWeekHint = r?.dgWeekHint?.trim() || null;
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

  countForTab(tab: HubTab): number {
    return this.modules.filter((m) => this.matchesStudentTab(m, tab)).length;
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

  /** Gluck Buddy tab: title search only (no level / language row). */
  showEmbeddedSearchOnly(): boolean {
    return this.modules.length > 0 && this.embedded && this.journeyFixedDay == null;
  }

  applyDayScope(): void {
    if (this.journeyFixedDay != null && Number.isFinite(Number(this.journeyFixedDay))) {
      const d = clampJourneyDay(this.journeyFixedDay);
      this.modules = this.allModules.filter((m) => this.moduleCourseDayNum(m) === d);
    } else {
      this.modules = [...this.allModules];
    }
    this.applyFilters();
  }

  private applyFilters(): void {
    const q = this.searchQuery.trim().toLowerCase();
    let list = this.journeyFixedDay != null
      ? [...this.modules]
      : this.modules.filter((m) => this.matchesStudentTab(m, this.activeTab));

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
    if (this.apiWeekHint) return this.apiWeekHint;
    if (this.unlockMode === 'weekly') {
      const start = (this.dgUnlockedWeek - 1) * 7 + 1;
      const end = this.dgUnlockedWeek * 7;
      return `Week ${this.dgUnlockedWeek}: journey days ${start}–${end}. Complete all modules in this week to unlock the next.`;
    }
    const a = this.studentCourseDay;
    const b = Math.min(200, a + 6);
    return `Journey days ${a}–${b}: “New” is tied to your current journey day.`;
  }

  get showWeeklyHint(): boolean {
    return this.unlockMode === 'weekly' && !this.journeyFixedDay;
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
    return clampJourneyDay(n);
  }

  isModuleCompleted(m: DgModuleSummary): boolean {
    return !!m.studentProgress?.completed;
  }

  /** Best saved time-goal progress (0–100) from ended sessions; 0 if none recorded. */
  moduleBestCompletionPercent(m: DgModuleSummary): number {
    const n = Number(m.studentProgress?.bestCompletionPercent);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(100, Math.round(n));
  }

  /** Started Gluck Buddy for this module but not fully complete (100% / natural wrap-up). */
  moduleHasPartialProgress(m: DgModuleSummary): boolean {
    return !this.isModuleCompleted(m) && this.moduleBestCompletionPercent(m) > 0;
  }

  hubStatusLabel(m: DgModuleSummary): string {
    if (this.isModuleCompleted(m)) return 'Completed';
    const p = this.moduleBestCompletionPercent(m);
    if (p > 0) return `${p}% completed`;
    return m.visibleToStudents ? 'Available' : 'Draft';
  }

  /**
   * Same flow as digital exercises (students):
   * - All: show everything (no filter).
   * - New: assigned journey day === current day, not fully complete, no saved partial progress yet.
   * - Pending: partial progress, past-day modules not finished, or no journey day assigned. Future-day modules (> current day) are excluded.
   * - Completed: module reached full completion (100% practice goal or natural conversation wrap-up).
   */
  private matchesStudentTab(m: DgModuleSummary, tab: HubTab): boolean {
    if (tab === 'all') return true;

    const completed = this.isModuleCompleted(m);
    const inProgress = this.moduleHasPartialProgress(m);
    const dayNum = this.moduleCourseDayNum(m);
    const cur = this.studentCourseDay;

    if (this.journeyFixedDay != null) {
      const d = clampJourneyDay(this.journeyFixedDay);
      if (tab === 'completed') {
        return completed;
      }
      if (completed) {
        return false;
      }
      if (tab === 'new') {
        return dayNum != null && dayNum === cur && d === cur && !inProgress;
      }
      return !(dayNum != null && dayNum === cur && d === cur && !inProgress);
    }

    if (tab === 'completed') {
      return completed;
    }
    if (completed) {
      return false;
    }
    if (tab === 'new') {
      return dayNum != null && dayNum === cur && !inProgress;
    }
    // Pending: in-progress (any day), no course day, or past days not yet finished.
    // Modules for future days (dayNum > cur) are NOT shown — they are still locked.
    return inProgress || dayNum == null || dayNum < cur;
  }

  journeyDayLabel(m: DgModuleSummary): string {
    const d = this.moduleCourseDayNum(m);
    if (d == null) return 'Any day';
    return d === 0 ? 'Trial' : `Day ${d}`;
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
