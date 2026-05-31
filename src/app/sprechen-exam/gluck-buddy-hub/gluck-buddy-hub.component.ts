import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { forkJoin } from 'rxjs';
import { DgBotHubComponent } from '../../dg-bot/dg-bot-hub/dg-bot-hub.component';
import { SprechenExamHubComponent } from '../sprechen-exam-hub/sprechen-exam-hub.component';
import { DgApiService } from '../../dg-bot/dg-api.service';
import { SprechenApiService } from '../sprechen-api.service';
import type { DgModuleSummary } from '../../dg-bot/dg-bot.types';
import type { SprechenExamModuleSummary } from '../sprechen-exam.types';

export type GluckBuddySubTab = 'practice' | 'exam';

@Component({
  selector: 'app-gluck-buddy-hub',
  standalone: true,
  imports: [CommonModule, DgBotHubComponent, SprechenExamHubComponent],
  templateUrl: './gluck-buddy-hub.component.html',
  styleUrl: './gluck-buddy-hub.component.scss',
})
export class GluckBuddyHubComponent implements OnInit {
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

  private readonly route = inject(ActivatedRoute);
  private readonly dgApi = inject(DgApiService);
  private readonly sprechenApi = inject(SprechenApiService);

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

  private loadModuleAvailability(): void {
    this.loadingAvailability = true;
    this.availabilityError = null;

    forkJoin({
      practice: this.dgApi.listStudentModules(),
      exam: this.sprechenApi.listStudentModules(),
    }).subscribe({
      next: ({ practice, exam }) => {
        const day = Number(practice?.studentCourseDay ?? exam?.studentCourseDay);
        if (Number.isFinite(day) && day >= 1) {
          this.studentCourseDay = Math.min(200, Math.floor(day));
        }

        const practiceAll = practice?.modules || [];
        const examAll = exam?.modules || [];
        this.practiceModuleCount = this.scopePracticeModules(practiceAll).length;
        this.examModuleCount = this.scopeExamModules(examAll).length;
        this.subTab = this.resolveInitialSubTab();
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
      const d = Math.min(200, Math.max(1, Math.floor(Number(this.journeyFixedDay))));
      return all.filter((m) => this.moduleCourseDayNum(m) === d);
    }
    return all;
  }

  private scopeExamModules(all: SprechenExamModuleSummary[]): SprechenExamModuleSummary[] {
    if (this.journeyFixedDay != null && Number.isFinite(Number(this.journeyFixedDay))) {
      const d = Math.min(200, Math.max(1, Math.floor(Number(this.journeyFixedDay))));
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
    return Number.isFinite(n) ? Math.min(200, Math.max(1, Math.floor(n))) : null;
  }

  private examModuleCourseDayNum(m: SprechenExamModuleSummary): number | null {
    const cd = m.courseDay;
    if (cd == null) return null;
    const n = Number(cd);
    return Number.isFinite(n) ? Math.min(200, Math.max(1, Math.floor(n))) : null;
  }
}
