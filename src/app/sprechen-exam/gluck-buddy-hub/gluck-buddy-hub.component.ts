import { Component, Input, OnInit, OnChanges, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { forkJoin } from 'rxjs';
import { DgBotHubComponent } from '../../dg-bot/dg-bot-hub/dg-bot-hub.component';
import { SprechenExamHubComponent } from '../sprechen-exam-hub/sprechen-exam-hub.component';
import { DgApiService } from '../../dg-bot/dg-api.service';
import { SprechenApiService } from '../sprechen-api.service';
import type { DgModuleSummary } from '../../dg-bot/dg-bot.types';
import type { SprechenExamModuleSummary } from '../sprechen-exam.types';
import { clampJourneyDay } from '../../utils/journey-day.util';

export type GluckBuddySubTab = 'practice' | 'exam';

@Component({
  selector: 'app-gluck-buddy-hub',
  standalone: true,
  imports: [CommonModule, DgBotHubComponent, SprechenExamHubComponent],
  templateUrl: './gluck-buddy-hub.component.html',
  styleUrl: './gluck-buddy-hub.component.scss',
})
export class GluckBuddyHubComponent implements OnInit, OnChanges {
  @Input() journeyFixedDay: number | null = null;
  @Input() hideEmbeddedHeader = false;
  @Input() showSubTabs = true;
  /** Force Exam tab when parent cannot pass query params (e.g. modal). */
  @Input() initialSubTab: GluckBuddySubTab | null = null;

  subTab: GluckBuddySubTab = 'practice';
  loadingAvailability = true;
  availabilityError: string | null = null;
  practiceModuleCount = 0;
  examModuleCount = 0;
  studentCourseDay = 1;

  /** Raw practice response metadata, passed to child DgBotHubComponent so it skips its own API call. */
  practiceUnlockMode: 'daily' | 'weekly' | 'none' = 'daily';
  practiceDgUnlockedWeek = 1;
  practiceDgWeekHint: string | null = null;

  private readonly route = inject(ActivatedRoute);
  private readonly dgApi = inject(DgApiService);
  private readonly sprechenApi = inject(SprechenApiService);

  practiceAll: DgModuleSummary[] = [];
  private examAll: SprechenExamModuleSummary[] = [];

  get showPracticeTab(): boolean {
    return this.practiceModuleCount > 0;
  }

  get showExamTab(): boolean {
    return this.examModuleCount > 0;
  }

  /** Show Practice/Exam switcher only when the student has both types assigned. */
  get showSegment(): boolean {
    return this.showSubTabs && this.showPracticeTab && this.showExamTab;
  }

  get hasAnyModules(): boolean {
    return this.showPracticeTab || this.showExamTab;
  }

  ngOnInit(): void {
    this.loadModuleAvailability();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['journeyFixedDay'] && !changes['journeyFixedDay'].firstChange) {
      this.recalculateModuleCounts();
    }
  }

  private loadModuleAvailability(): void {
    this.loadingAvailability = true;
    this.availabilityError = null;

    forkJoin({
      practice: this.dgApi.listStudentModules(),
      exam: this.sprechenApi.listStudentModules(),
    }).subscribe({
      next: ({ practice, exam }) => {
        const day = Number(practice?.studentCourseDay ?? exam?.studentCourseDay);
        if (Number.isFinite(day) && day >= 0) {
          this.studentCourseDay = Math.min(200, Math.floor(day));
        }

        this.practiceAll = practice?.modules || [];
        this.practiceUnlockMode = practice?.unlockMode === 'weekly' ? 'weekly' : practice?.unlockMode === 'none' ? 'none' : 'daily';
        this.practiceDgUnlockedWeek = Number.isFinite(Number(practice?.dgUnlockedWeek)) && Number(practice?.dgUnlockedWeek) >= 1 ? Math.floor(Number(practice?.dgUnlockedWeek)) : 1;
        this.practiceDgWeekHint = practice?.dgWeekHint?.trim() || null;
        this.examAll = exam?.modules || [];
        this.recalculateModuleCounts();
        this.loadingAvailability = false;
      },
      error: () => {
        this.availabilityError = 'Could not load Glück Buddy modules.';
        this.practiceModuleCount = 0;
        this.examModuleCount = 0;
        this.loadingAvailability = false;
      },
    });
  }

  private recalculateModuleCounts(): void {
    this.practiceModuleCount = this.scopePracticeModules(this.practiceAll).length;
    this.examModuleCount = this.scopeExamModules(this.examAll).length;
    this.subTab = this.resolveInitialSubTab();
  }

  private resolveInitialSubTab(): GluckBuddySubTab {
    const wantExam =
      this.initialSubTab === 'exam' ||
      this.route.snapshot.queryParamMap.get('buddy') === 'exam';

    if (wantExam && this.showExamTab) return 'exam';
    if (this.showPracticeTab) return 'practice';
    if (this.showExamTab) return 'exam';
    return 'practice';
  }

  private scopePracticeModules(all: DgModuleSummary[]): DgModuleSummary[] {
    if (this.journeyFixedDay != null && Number.isFinite(Number(this.journeyFixedDay))) {
      const d = clampJourneyDay(this.journeyFixedDay);
      return all.filter((m) => this.moduleCourseDayNum(m) === d);
    }
    return all;
  }

  private scopeExamModules(all: SprechenExamModuleSummary[]): SprechenExamModuleSummary[] {
    if (this.journeyFixedDay != null && Number.isFinite(Number(this.journeyFixedDay))) {
      const d = clampJourneyDay(this.journeyFixedDay);
      return all.filter((m) => this.examModuleCourseDayNum(m) === d);
    }
    return all.filter(
      (m) =>
        this.examModuleCourseDayNum(m) === this.studentCourseDay ||
        this.examModuleCourseDayNum(m) == null,
    );
  }

  private moduleCourseDayNum(m: DgModuleSummary): number | null {
    const cd = m.courseDay;
    if (cd == null) return null;
    const n = Number(cd);
    return Number.isFinite(n) ? clampJourneyDay(n) : null;
  }

  private examModuleCourseDayNum(m: SprechenExamModuleSummary): number | null {
    const cd = m.courseDay;
    if (cd == null) return null;
    const n = Number(cd);
    return Number.isFinite(n) ? clampJourneyDay(n) : null;
  }
}
