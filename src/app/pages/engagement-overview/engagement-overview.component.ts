import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  EngagementOverviewService,
  EngBatch,
  EngStudent,
  EngBand,
} from './engagement-overview.service';

type BandFilter = 'all' | EngBand;
type SortKey = 'batch' | 'worst' | 'best';

@Component({
  selector: 'app-engagement-overview',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './engagement-overview.component.html',
  styleUrls: ['./engagement-overview.component.scss'],
})
export class EngagementOverviewComponent implements OnInit {
  loading = signal(true);
  error = signal<string | null>(null);
  targetHours = signal(6);
  totalWeeks = signal(29);
  batches = signal<EngBatch[]>([]);

  // Filters
  search = signal('');
  bandFilter = signal<BandFilter>('all');
  level = signal('');
  sort = signal<SortKey>('batch');

  // Popups: batch list (first level) + single-student detail (second level)
  batchDetail = signal<EngBatch | null>(null);
  selected = signal<{ student: EngStudent; batch: string; week: number | null } | null>(null);

  readonly bandLabels: Record<EngBand, string> = {
    red: 'Below 40%',
    yellow: '40–75%',
    green: '75%+',
  };

  constructor(private readonly api: EngagementOverviewService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getOverview().subscribe({
      next: (res) => {
        this.targetHours.set(res.targetHours);
        this.totalWeeks.set(res.totalWeeks);
        this.batches.set(res.batches);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load engagement overview. Please try again.');
        this.loading.set(false);
      },
    });
  }

  /** Distinct levels present, for the level filter dropdown. */
  levels = computed(() => {
    const set = new Set<string>();
    for (const b of this.batches()) {
      for (const s of b.students) if (s.level) set.add(s.level);
    }
    return Array.from(set).sort();
  });

  /** Totals + distribution across all batches, for the KPI cards + bar. */
  totals = computed(() => {
    let red = 0, yellow = 0, green = 0, students = 0;
    for (const b of this.batches()) {
      red += b.bands.red;
      yellow += b.bands.yellow;
      green += b.bands.green;
      students += b.studentCount;
    }
    const pct = (n: number) => (students ? Math.round((n / students) * 100) : 0);
    const health = students
      ? Math.round((green * 100 + yellow * 55 + red * 15) / students)
      : 0;

    // Display widths for the stacked bar: non-zero bands get a minimum sliver
    // so e.g. 2 green students out of 376 are still visible; normalized to 100.
    const MIN_SLIVER = 1.5;
    const raw = students
      ? { r: (red / students) * 100, y: (yellow / students) * 100, g: (green / students) * 100 }
      : { r: 0, y: 0, g: 0 };
    let dr = raw.r > 0 ? Math.max(raw.r, MIN_SLIVER) : 0;
    let dy = raw.y > 0 ? Math.max(raw.y, MIN_SLIVER) : 0;
    let dg = raw.g > 0 ? Math.max(raw.g, MIN_SLIVER) : 0;
    const sum = dr + dy + dg;
    if (sum > 0) {
      const k = 100 / sum;
      dr *= k; dy *= k; dg *= k;
    }

    return {
      red, yellow, green, students,
      batches: this.batches().length,
      redPct: pct(red), yellowPct: pct(yellow), greenPct: pct(green),
      distRed: dr, distYellow: dy, distGreen: dg,
      health,
    };
  });

  /** Week options 1..totalWeeks for the per-batch dropdown. */
  weekOptions = computed(() => Array.from({ length: this.totalWeeks() }, (_, i) => i + 1));

  /** Batches after search/sort; per-student band/level filtering happens in the template. */
  visibleBatches = computed(() => {
    const q = this.search().trim().toLowerCase();
    const filtering = this.bandFilter() !== 'all' || !!this.level();
    let list = this.batches().filter((b) => !q || b.batchName.toLowerCase().includes(q));
    // When a band/level filter is active, only show batches that have matching students.
    if (filtering) list = list.filter((b) => this.studentsFor(b).length > 0);

    const bnum = (n: string) => {
      const m = n.match(/\d+/);
      return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
    };
    const sk = this.sort();
    list = [...list].sort((a, b) => {
      if (sk === 'batch') return bnum(a.batchName) - bnum(b.batchName);
      const pa = this.greenPct(a), pb = this.greenPct(b);
      return sk === 'worst' ? pa - pb : pb - pa;
    });
    return list;
  });

  /** Students in a batch after band + level filters. */
  studentsFor(b: EngBatch): EngStudent[] {
    const band = this.bandFilter();
    const lvl = this.level();
    return b.students
      .filter((s) => (band === 'all' || s.band === band) && (!lvl || s.level === lvl))
      .sort((a, b) => {
        if (b.minutes !== a.minutes) return b.minutes - a.minutes;
        if (b.pct !== a.pct) return b.pct - a.pct;
        return a.name.localeCompare(b.name);
      });
  }

  bandCount(b: EngBatch, band: EngBand): number {
    return b.bands[band];
  }

  bandPct(b: EngBatch, band: EngBand): number {
    if (!b.studentCount) return 0;
    return Math.round((b.bands[band] / b.studentCount) * 100);
  }

  greenPct(b: EngBatch): number {
    return b.studentCount ? (b.bands.green / b.studentCount) * 100 : 0;
  }

  /** Batch-level average health, drives the health pill colour. */
  healthPct(b: EngBatch): number {
    if (!b.studentCount) return 0;
    const score = b.bands.green * 100 + b.bands.yellow * 55 + b.bands.red * 15;
    return Math.round(score / b.studentCount);
  }

  trackingLabel(b: EngBatch): string {
    if (!b.hasJourney) return 'Rolling last 7 days';
    return b.selectedWeek === b.currentWeek
      ? `Week ${b.selectedWeek} (current)`
      : `Week ${b.selectedWeek}`;
  }

  trackingHint(b: EngBatch): string {
    return b.hasJourney
      ? 'Week-based view is available because this batch has a journey start date configured.'
      : 'Week selector is unavailable because this batch does not have a journey start date configured yet.';
  }

  onTargetCount(b: EngBatch): number {
    return b.bands.green;
  }

  onWeekChange(b: EngBatch, week: number): void {
    b.loading = true;
    this.api.getBatch(b.batchName, week).subscribe({
      next: (fresh) => {
        const list = this.batches().map((x) => (x.batchName === b.batchName ? fresh : x));
        this.batches.set(list);
      },
      error: () => {
        b.loading = false;
      },
    });
  }

  /** Segmented-bar display widths for one batch (tiny bands still get a sliver). */
  batchDist(b: EngBatch): { r: number; y: number; g: number } {
    const t = b.studentCount;
    if (!t) return { r: 0, y: 0, g: 0 };
    const MIN = 3;
    let r = b.bands.red ? Math.max((b.bands.red / t) * 100, MIN) : 0;
    let y = b.bands.yellow ? Math.max((b.bands.yellow / t) * 100, MIN) : 0;
    let g = b.bands.green ? Math.max((b.bands.green / t) * 100, MIN) : 0;
    const sum = r + y + g;
    if (sum > 0) { const k = 100 / sum; r *= k; y *= k; g *= k; }
    return { r, y, g };
  }

  openBatch(b: EngBatch): void {
    if (b.studentCount) this.batchDetail.set(b);
  }

  closeBatch(): void {
    this.batchDetail.set(null);
  }

  openStudent(student: EngStudent, batch: EngBatch): void {
    this.selected.set({ student, batch: batch.batchName, week: batch.selectedWeek });
  }

  closeStudent(): void {
    this.selected.set(null);
  }

  trackBatch = (_: number, b: EngBatch) => b.batchName;
  trackStudent = (_: number, s: EngStudent) => s.studentId;
}
