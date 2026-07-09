import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  EngagementOverviewService,
  EngBatch,
  EngStudent,
  EngBand,
  ClassBatch,
  ClassStudent,
  PaymentBatch,
  PaymentStudent,
} from './engagement-overview.service';

export type ActiveTab = 'learning' | 'classes' | 'payment' | 'overall';

export interface OverallBatch {
  batchName: string;
  batchType: string;
  studentCount: number;
  overall: EngBand;
  learning: EngBand | null;
  classes: EngBand | null;
  payment: EngBand | null;
}

@Component({
  selector: 'app-engagement-overview',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './engagement-overview.component.html',
  styleUrls: ['./engagement-overview.component.scss'],
})
export class EngagementOverviewComponent implements OnInit {
  // ── Tab ──────────────────────────────────────────────────────────────────────
  activeTab = signal<ActiveTab>('learning');

  // ── Learning tab ─────────────────────────────────────────────────────────────
  loading = signal(true);
  error = signal<string | null>(null);
  targetHours = signal(6);
  batches = signal<EngBatch[]>([]);
  search = signal('');

  batchDetail = signal<EngBatch | null>(null);
  selected = signal<{ student: EngStudent; batch: string; week: number | null } | null>(null);

  readonly bandLabels: Record<EngBand, string> = {
    red: '0–3 hrs',
    yellow: '3–6 hrs',
    green: '6 h+',
  };

  /** Placeholder rows for skeleton loading */
  readonly skeletonKpis = [0, 1, 2, 3, 4];
  readonly skeletonRows = [0, 1, 2, 3, 4, 5, 6, 7];

  // ── Classes tab ──────────────────────────────────────────────────────────────
  classLoading = signal(true);
  classError = signal<string | null>(null);
  classBatches = signal<ClassBatch[]>([]);
  classSearch = signal('');
  classLoaded = signal(false);

  classBatchDetail = signal<ClassBatch | null>(null);
  classSelected = signal<{ student: ClassStudent; batch: string; level: string } | null>(null);

  readonly attendanceBandLabels: Record<EngBand, string> = {
    red: '< 60% attendance',
    yellow: '60–80% attendance',
    green: '> 80% attendance',
  };

  // ── Payment tab ──────────────────────────────────────────────────────────────
  paymentLoading = signal(true);
  paymentError = signal<string | null>(null);
  paymentBatches = signal<PaymentBatch[]>([]);
  paymentLoaded = signal(false);

  paymentBatchDetail = signal<PaymentBatch | null>(null);
  paymentSelected = signal<{ student: PaymentStudent; batch: string; level: string } | null>(null);

  readonly paymentBandLabels: Record<EngBand, string> = {
    green: 'Full paid',
    yellow: 'Pending · day 1–5',
    red: 'Pending · day 6+',
  };

  constructor(private readonly api: EngagementOverviewService) {}

  ngOnInit(): void {
    this.load();
  }

  // ── Tab switching ─────────────────────────────────────────────────────────────
  switchTab(tab: ActiveTab): void {
    this.activeTab.set(tab);
    if ((tab === 'classes' || tab === 'overall') && !this.classLoaded()) {
      this.loadClasses();
    }
    if ((tab === 'payment' || tab === 'overall') && !this.paymentLoaded()) {
      this.loadPayment();
    }
  }

  // ── Learning: load ────────────────────────────────────────────────────────────
  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getOverview().subscribe({
      next: (res) => {
        this.targetHours.set(res.targetHours);
        this.batches.set(res.batches.map((b) => ({ ...b, students: [] })));
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load engagement data. Please try again.');
        this.loading.set(false);
      },
    });
  }

  // ── Learning: computed ────────────────────────────────────────────────────────
  totals = computed(() => {
    let red = 0, yellow = 0, green = 0, fiveToSix = 0, students = 0;
    for (const b of this.batches()) {
      red += b.bands.red;
      yellow += b.bands.yellow;
      green += b.bands.green;
      fiveToSix += b.bands.fiveToSix ?? 0;
      students += b.studentCount;
    }
    const pct = (n: number) => (students ? Math.round((n / students) * 100) : 0);
    return {
      red, yellow, green, fiveToSix, students,
      batches: this.batches().length,
      redPct: pct(red), yellowPct: pct(yellow), greenPct: pct(green),
      onTargetPct: pct(green),
    };
  });

  visibleBatches = computed(() => {
    const q = this.search().trim().toLowerCase();
    let list = this.batches().filter(
      (b) => b.batchType === 'new' || b.batchType === 'new2'
    );
    if (q) list = list.filter((b) => b.batchName.toLowerCase().includes(q));
    return list;
  });

  weekOptionsFor(b: EngBatch): number[] {
    if (!b.hasJourney || b.currentWeek === null) return [];
    return Array.from({ length: b.currentWeek }, (_, i) => i + 1);
  }

  studentsFor(b: EngBatch): EngStudent[] {
    return [...b.students].sort((a, c) => {
      if (c.minutes !== a.minutes) return c.minutes - a.minutes;
      return a.name.localeCompare(c.name);
    });
  }

  bandCount(b: EngBatch, band: EngBand): number {
    return b.bands[band];
  }

  onTargetPct(b: EngBatch): number {
    return b.studentCount ? Math.round((b.bands.green / b.studentCount) * 100) : 0;
  }

  healthClass(b: EngBatch): string {
    const p = this.onTargetPct(b);
    if (p >= 50) return 'good';
    if (p >= 25) return 'mid';
    return 'low';
  }

  onWeekChange(b: EngBatch, week: number): void {
    b.loading = true;
    this.api.getBatch(b.batchName, week).subscribe({
      next: (fresh) => {
        const lite = { ...fresh, students: [], loading: false };
        const list = this.batches().map((x) => (x.batchName === b.batchName ? lite : x));
        this.batches.set(list);
      },
      error: () => {
        b.loading = false;
      },
    });
  }

  weekLabel(b: EngBatch): string {
    if (!b.hasJourney) return 'Rolling 7 days';
    if (b.selectedWeek === 0) return 'Overall';
    if (b.selectedWeek === b.currentWeek) return `Week ${b.selectedWeek} (current)`;
    if (b.currentWeek && b.selectedWeek === b.currentWeek - 1) {
      return `Week ${b.selectedWeek} (last week)`;
    }
    return `Week ${b.selectedWeek}`;
  }

  openBatch(b: EngBatch): void {
    if (!b.studentCount) return;

    const week = b.selectedWeek ?? b.currentWeek ?? 1;
    if (b.students?.length) {
      this.batchDetail.set(b);
      return;
    }

    this.batchDetail.set({ ...b, loading: true });
    this.api.getBatch(b.batchName, week).subscribe({
      next: (fresh) => {
        const list = this.batches().map((x) => (x.batchName === b.batchName ? fresh : x));
        this.batches.set(list);
        this.batchDetail.set(fresh);
      },
      error: () => {
        this.batchDetail.set(null);
      },
    });
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

  // ── Classes: load ─────────────────────────────────────────────────────────────
  loadClasses(): void {
    this.classLoading.set(true);
    this.classError.set(null);
    this.api.getClassOverview().subscribe({
      next: (res) => {
        this.classBatches.set(res.batches);
        this.classLoading.set(false);
        this.classLoaded.set(true);
      },
      error: () => {
        this.classError.set('Failed to load class attendance data. Please try again.');
        this.classLoading.set(false);
      },
    });
  }

  refreshClasses(): void {
    this.classLoaded.set(false);
    this.loadClasses();
  }

  // ── Classes: computed ─────────────────────────────────────────────────────────
  classTotals = computed(() => {
    let red = 0, yellow = 0, green = 0, students = 0;
    for (const b of this.classBatches()) {
      red += b.bands.red;
      yellow += b.bands.yellow;
      green += b.bands.green;
      students += b.studentCount;
    }
    const pct = (n: number) => (students ? Math.round((n / students) * 100) : 0);
    return {
      red, yellow, green, students,
      batches: this.classBatches().length,
      redPct: pct(red), yellowPct: pct(yellow), greenPct: pct(green),
      onTargetPct: pct(green),
    };
  });

  visibleClassBatches = computed(() => {
    const q = this.classSearch().trim().toLowerCase();
    let list = [...this.classBatches()];
    if (q) list = list.filter((b) => b.batchName.toLowerCase().includes(q));
    return list;
  });

  classStudentsFor(b: ClassBatch): ClassStudent[] {
    return [...b.students].sort((a, c) => {
      if (a.attendancePct !== c.attendancePct) return a.attendancePct - c.attendancePct;
      return a.name.localeCompare(c.name);
    });
  }

  classOnTargetPct(b: ClassBatch): number {
    return b.studentCount ? Math.round((b.bands.green / b.studentCount) * 100) : 0;
  }

  classHealthClass(b: ClassBatch): string {
    const p = this.classOnTargetPct(b);
    if (p >= 50) return 'good';
    if (p >= 25) return 'mid';
    return 'low';
  }

  onLevelChange(b: ClassBatch, level: string): void {
    b.loading = true;
    this.api.getClassBatch(b.batchName, level).subscribe({
      next: (fresh) => {
        const list = this.classBatches().map((x) =>
          x.batchName === b.batchName ? fresh : x
        );
        this.classBatches.set(list);
      },
      error: () => {
        b.loading = false;
      },
    });
  }

  openClassBatch(b: ClassBatch): void {
    if (b.studentCount) this.classBatchDetail.set(b);
  }

  closeClassBatch(): void {
    this.classBatchDetail.set(null);
  }

  openClassStudent(student: ClassStudent, batch: ClassBatch): void {
    this.classSelected.set({ student, batch: batch.batchName, level: batch.selectedLevel });
  }

  closeClassStudent(): void {
    this.classSelected.set(null);
  }

  // ── Payment: load ─────────────────────────────────────────────────────────────
  loadPayment(): void {
    this.paymentLoading.set(true);
    this.paymentError.set(null);
    this.api.getPaymentOverview().subscribe({
      next: (res) => {
        this.paymentBatches.set(res.batches);
        this.paymentLoading.set(false);
        this.paymentLoaded.set(true);
      },
      error: () => {
        this.paymentError.set('Failed to load payment data. Please try again.');
        this.paymentLoading.set(false);
      },
    });
  }

  refreshPayment(): void {
    this.paymentLoaded.set(false);
    this.loadPayment();
  }

  // ── Payment: computed ─────────────────────────────────────────────────────────
  paymentTotals = computed(() => {
    let red = 0, yellow = 0, green = 0, students = 0;
    for (const b of this.paymentBatches()) {
      red += b.bands.red;
      yellow += b.bands.yellow;
      green += b.bands.green;
      students += b.studentCount;
    }
    const pct = (n: number) => (students ? Math.round((n / students) * 100) : 0);
    return { red, yellow, green, students, batches: this.paymentBatches().length, greenPct: pct(green) };
  });

  visiblePaymentBatches = computed(() => [...this.paymentBatches()]);

  paymentStudentsFor(b: PaymentBatch): PaymentStudent[] {
    return [...b.students];
  }

  paymentHealthPct(b: PaymentBatch): number {
    return b.studentCount ? Math.round((b.bands.green / b.studentCount) * 100) : 0;
  }

  paymentHealthClass(b: PaymentBatch): string {
    const p = this.paymentHealthPct(b);
    if (p >= 50) return 'good';
    if (p >= 25) return 'mid';
    return 'low';
  }

  onPaymentLevelChange(b: PaymentBatch, level: string): void {
    b.loading = true;
    this.api.getPaymentBatch(b.batchName, level).subscribe({
      next: (fresh) => {
        const list = this.paymentBatches().map((x) =>
          x.batchName === b.batchName ? fresh : x
        );
        this.paymentBatches.set(list);
      },
      error: () => { b.loading = false; },
    });
  }

  openPaymentBatch(b: PaymentBatch): void {
    if (b.studentCount) this.paymentBatchDetail.set(b);
  }

  closePaymentBatch(): void {
    this.paymentBatchDetail.set(null);
  }

  openPaymentStudent(student: PaymentStudent, batch: PaymentBatch): void {
    this.paymentSelected.set({ student, batch: batch.batchName, level: batch.selectedLevel });
  }

  closePaymentStudent(): void {
    this.paymentSelected.set(null);
  }

  paymentHealthLabel(s: PaymentStudent): string {
    if (s.band === 'green') return 'Full Paid';
    const d = s.daysIntoLevel;
    if (d == null) return 'Pending';
    if (s.band === 'yellow') return `Day ${d} of level · safe`;
    return `Day ${d} of level · urgent`;
  }

  // ── Overall tab ───────────────────────────────────────────────────────────
  overallLoading = computed(() =>
    this.loading() || this.classLoading() || this.paymentLoading()
  );

  overallBatches = computed((): OverallBatch[] => {
    const lMap = new Map(this.batches().map(b => [b.batchName, b]));
    const cMap = new Map(this.classBatches().map(b => [b.batchName, b]));
    const pMap = new Map(this.paymentBatches().map(b => [b.batchName, b]));

    const allNames = new Set([...lMap.keys(), ...cMap.keys(), ...pMap.keys()]);

    return Array.from(allNames)
      .sort((a, b) => Number(a) - Number(b))
      .map(name => {
        const lb = lMap.get(name);
        const cb = cMap.get(name);
        const pb = pMap.get(name);

        const lColor = lb ? this.dominantBatchColor(lb.bands) : null;
        const cColor = cb ? this.dominantBatchColor(cb.bands) : null;
        const pColor = pb ? this.dominantBatchColor(pb.bands) : null;

        const available = [lColor, cColor, pColor].filter((c): c is EngBand => c !== null);
        const overall: EngBand = this.worstColor(available);

        return {
          batchName: name,
          batchType: lb?.batchType ?? cb?.batchType ?? pb?.batchType ?? 'new',
          studentCount: lb?.studentCount ?? cb?.studentCount ?? pb?.studentCount ?? 0,
          overall,
          learning: lColor,
          classes: cColor,
          payment: pColor,
        };
      });
  });

  overallTotals = computed(() => {
    let green = 0, yellow = 0, red = 0;
    for (const b of this.overallBatches()) {
      if (b.overall === 'green') green++;
      else if (b.overall === 'yellow') yellow++;
      else red++;
    }
    return { green, yellow, red, total: this.overallBatches().length };
  });

  private dominantBatchColor(bands: { red: number; yellow: number; green: number }): EngBand {
    if (bands.red >= bands.yellow && bands.red >= bands.green) return 'red';
    if (bands.yellow >= bands.green) return 'yellow';
    return 'green';
  }

  private worstColor(colors: EngBand[]): EngBand {
    if (!colors.length) return 'green';
    if (colors.includes('red')) return 'red';
    if (colors.includes('yellow')) return 'yellow';
    return 'green';
  }

  bandPct(total: number, count: number): string {
    if (!total) return '0%';
    return Math.round((count / total) * 100) + '%';
  }

  formatAmount(amount: number): string {
    if (!amount) return '—';
    return `LKR ${amount.toLocaleString()}`;
  }

  // ── Trackers ──────────────────────────────────────────────────────────────────
  trackBatch = (_: number, b: EngBatch) => b.batchName;
  trackStudent = (_: number, s: EngStudent) => s.studentId;
  trackClassBatch = (_: number, b: ClassBatch) => b.batchName;
  trackClassStudent = (_: number, s: ClassStudent) => s.studentId;
  trackPaymentBatch = (_: number, b: PaymentBatch) => b.batchName;
  trackPaymentStudent = (_: number, s: PaymentStudent) => s.studentId;
}
