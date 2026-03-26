import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { forkJoin, of, catchError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { StudentProgressService } from '../../services/student-progress.service';
import { AuthService } from '../../services/auth.service';
import { ZoomService } from '../../services/zoom.service';
import { StudentMeetingsComponent } from '../meeting-link/student-meetings.component';
import { StudentRecordingsComponent } from '../class-recordings/student-recordings/student-recordings.component';
import { DigitalExercisesComponent } from '../digital-exercises/digital-exercises.component';
import { LearningModulesComponent } from '../learning-modules/learning-modules.component';
import { DigitalExercise, DigitalExerciseService } from '../../services/digital-exercise.service';
import { LearningModule, LearningModulesService } from '../../services/learning-modules.service';

type MyCourseTab = 'classes' | 'exercises' | 'modules';

@Component({
  selector: 'app-my-course',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    StudentMeetingsComponent,
    StudentRecordingsComponent,
    DigitalExercisesComponent,
    LearningModulesComponent
  ],
  templateUrl: './my-course.component.html',
  styleUrls: ['./my-course.component.scss']
})
export class MyCourseComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  journey: any = null;
  loading = true;
  activeTab: MyCourseTab = 'classes';
  /** Fallback when journey.profile.profilePic is empty (login/profile API often has photo). */
  private authProfilePicRaw: string | null = null;
  /** Next upcoming live class (not ended, not ongoing). */
  nextMeetingPreview: { topic: string; whenLabel: string } | null = null;

  /** Quick access: newest unlocked + not-started exercise. */
  nextNewDigitalExercise: DigitalExercise | null = null;

  /** Quick access: newest accessible module not completed. */
  nextNewAccessibleModule: LearningModule | null = null;

  private readonly motivateLines = [
    'You’re going strong — keep showing up!',
    'Small steps every day add up. Proud of you!',
    'Consistency wins. You’ve got this!',
    'Great rhythm — stay curious and keep practicing.',
    'Progress, not perfection. You’re doing really well.',
    'Every day you learn something new. Keep it up!',
    'Your future self will thank you for today’s effort.'
  ];

  constructor(
    private progressService: StudentProgressService,
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService,
    private zoomService: ZoomService,
    private exerciseService: DigitalExerciseService,
    private learningModulesService: LearningModulesService
  ) {}

  ngOnInit(): void {
    this.setAuthProfilePicFromUser(this.authService.getSnapshotUser());
    this.authService.currentUser$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((u) => this.setAuthProfilePicFromUser(u));
    this.authService.getUserProfile().subscribe({
      next: (u) => this.setAuthProfilePicFromUser(u),
      error: () => {}
    });

    forkJoin({
      journey: this.progressService.getStudentJourney(),
      meetings: this.zoomService.getStudentMeetings().pipe(
        catchError(() => of({ success: false, data: [] }))
      )
    }).subscribe({
      next: ({ journey, meetings }) => {
        this.journey = journey;
        this.applyMeetingsPreview(meetings);
        this.loadQuickAccess();
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });

    this.route.queryParamMap.subscribe((q) => {
      const t = q.get('tab');
      if (t === 'exercises' || t === 'modules' || t === 'classes') {
        this.activeTab = t;
      }
    });
  }

  private loadQuickAccess(): void {
    this.nextNewDigitalExercise = null;
    this.nextNewAccessibleModule = null;

    const courseDay = this.journeyCourseDay;
    const levelRaw = this.profile?.currentLevel || this.profile?.currentLevelCode || this.profile?.level;
    const studentLevel = typeof levelRaw === 'string' ? levelRaw.split(/\s+/)[0] : '';

    this.exerciseService
      .getExercises({ page: 1, limit: 24 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const items: DigitalExercise[] = Array.isArray(res?.exercises) ? res.exercises : [];
          const unlocked = items.filter((ex) => {
            const noAttempt = !ex.studentAttempt;
            if (!noAttempt) return false;
            const exDay = ex.courseDay;
            return exDay == null || exDay <= courseDay;
          });
          unlocked.sort((a, b) => this.getPublishedTs(b) - this.getPublishedTs(a));
          this.nextNewDigitalExercise = unlocked[0] || null;
        }
      });

    if (studentLevel) {
      this.learningModulesService
        .getAccessibleModules(studentLevel, { page: 1, limit: 8 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            const modules: LearningModule[] = Array.isArray(res?.modules) ? res.modules : [];
            const candidates = modules.filter((m: any) => {
              // Module is "new/available" if student hasn't completed it.
              return !m.studentProgress || m.studentProgress.status !== 'completed';
            });
            candidates.sort((a: any, b: any) => this.getPublishedTs(b) - this.getPublishedTs(a));
            this.nextNewAccessibleModule = candidates[0] || null;
          },
          error: () => {}
        });
    }
  }

  private getPublishedTs(item: any): number {
    const raw = item?.publishedAt || item?.createdAt;
    const t = raw ? new Date(raw).getTime() : NaN;
    return Number.isFinite(t) ? t : 0;
  }

  get updatesPrimaryTab(): MyCourseTab {
    if (this.nextNewDigitalExercise || this.nextLockedDigitalExercise) return 'exercises';
    if (this.nextNewAccessibleModule) return 'modules';
    return 'exercises';
  }

  get updatesLinkText(): string {
    if (this.updatesPrimaryTab === 'modules') return 'Go to modules';
    return 'Go to exercises';
  }

  setTab(tab: MyCourseTab): void {
    this.activeTab = tab;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  get levelProgression(): any[] {
    return this.journey?.levelProgression || [];
  }

  get profile(): any {
    return this.journey?.profile || {};
  }

  get studentFirstName(): string {
    const name = (this.profile?.name || '').trim();
    if (!name) return 'there';
    return name.split(/\s+/)[0];
  }

  get studentInitial(): string {
    const n = this.studentFirstName;
    if (!n || n === 'there') return '?';
    return n.charAt(0).toUpperCase();
  }

  /** Absolute URL for profile photo, or null if none. */
  get profilePhotoUrl(): string | null {
    const journeyPic = (this.profile?.profilePic || '').trim();
    const authPic = (this.authProfilePicRaw || '').trim();
    const raw = journeyPic || authPic;
    if (!raw) return null;
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    const base = environment.apiUrl.replace(/\/api\/?$/, '');
    return `${base}${raw.startsWith('/') ? raw : '/' + raw}`;
  }

  private setAuthProfilePicFromUser(u: any | null): void {
    if (!u) return;
    const r = (u.profilePhotoUrl || u.profilePic || '').trim();
    if (r) this.authProfilePicRaw = r;
  }

  /** Short level code for the hero (e.g. A2, B1). */
  get levelShortLabel(): string {
    const cur = this.levelProgression.find((l: any) => l.status === 'in-progress');
    if (cur?.level) return String(cur.level);
    const fromProfile = this.profile?.currentLevel;
    if (fromProfile) return String(fromProfile).split(/\s+/)[0];
    return '—';
  }

  get learningPct(): number {
    const lp = this.levelProgression;
    const completed = lp.filter((l: any) => l.status === 'completed').length;
    return lp.length ? Math.round((completed / lp.length) * 100) : 0;
  }

  /** Calendar days since enrollment (same calendar day = 1). Matches “day 10 → day 15 = 5”. */
  get elapsedJourneyDayNumber(): number {
    const raw = this.profile?.enrollmentDate;
    if (!raw) return 1;
    const enroll = new Date(raw);
    if (isNaN(enroll.getTime())) return 1;
    const e0 = this.startOfLocalDay(enroll);
    const t0 = this.startOfLocalDay(new Date());
    const diffDays = Math.floor((t0.getTime() - e0.getTime()) / 86400000);
    return Math.max(1, diffDays);
  }

  get motivateLine(): string {
    const n = this.elapsedJourneyDayNumber;
    return this.motivateLines[n % this.motivateLines.length];
  }

  get nextLockedDigitalExercise(): { title: string; courseDay: number; daysUntilUnlock: number } | null {
    const x = this.journey?.nextLockedDigitalExercise;
    if (!x || x.courseDay == null) return null;
    return {
      title: (x.title || 'Digital exercise').trim(),
      courseDay: Number(x.courseDay),
      daysUntilUnlock: Math.max(0, Number(x.daysUntilUnlock) || 0)
    };
  }

  get journeyCourseDay(): number {
    const d = this.profile?.currentCourseDay;
    if (d == null || !Number.isFinite(Number(d))) return 1;
    return Math.min(200, Math.max(1, Math.floor(Number(d))));
  }

  ordinalSuffix(n: number): string {
    const v = n % 100;
    if (v >= 11 && v <= 13) return 'th';
    switch (n % 10) {
      case 1:
        return 'st';
      case 2:
        return 'nd';
      case 3:
        return 'rd';
      default:
        return 'th';
    }
  }

  private startOfLocalDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  private applyMeetingsPreview(res: any): void {
    this.nextMeetingPreview = null;
    if (!res?.success || !Array.isArray(res.data)) return;
    const list = res.data.filter((m: any) => !m.hasEnded && !m.isOngoing);
    if (!list.length) return;
    list.sort(
      (a: any, b: any) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
    const m = list[0];
    const topic = (m.topic || 'Live class').trim();
    const whenLabel = this.formatMeetingSoonLabel(new Date(m.startTime));
    this.nextMeetingPreview = { topic, whenLabel };
  }

  private formatMeetingSoonLabel(start: Date): string {
    if (isNaN(start.getTime())) return '';
    const t0 = this.startOfLocalDay(new Date());
    const s0 = this.startOfLocalDay(start);
    const diff = Math.round((s0.getTime() - t0.getTime()) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff > 1 && diff <= 7) return `In ${diff} days`;
    return start.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  }

  lockedExerciseUnlockText(ex: { daysUntilUnlock: number }): string {
    const d = ex.daysUntilUnlock;
    if (d <= 0) return 'Unlocked on your current journey day — open Exercises to start.';
    if (d === 1) return 'Locked for now — it unlocks tomorrow on your journey.';
    return `Locked for now — ${d} more journey days until it opens.`;
  }

}
