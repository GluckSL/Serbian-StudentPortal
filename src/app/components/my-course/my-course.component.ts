import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { of, catchError, interval } from 'rxjs';
import { environment } from '../../../environments/environment';
import { StudentProgressService } from '../../services/student-progress.service';
import { AuthService } from '../../services/auth.service';
import { ZoomService } from '../../services/zoom.service';
import { JoinClassFlowService } from '../../services/join-class-flow.service';
import { NotificationService } from '../../services/notification.service';
import { StudentMeetingsComponent } from '../meeting-link/student-meetings.component';
import { StudentRecordingsComponent } from '../class-recordings/student-recordings/student-recordings.component';
import { DigitalExercisesComponent } from '../digital-exercises/digital-exercises.component';
// Digital learning modules (Modules tab) removed from student My Course — use Gluck Buddy for DG speaking practice.
// import { LearningModulesComponent } from '../learning-modules/learning-modules.component';
import { GluckBuddyHubComponent } from '../../sprechen-exam/gluck-buddy-hub/gluck-buddy-hub.component';
import { DgApiService } from '../../dg-bot/dg-api.service';
import { DgModuleSummary } from '../../dg-bot/dg-bot.types';
import { DigitalExercise, DigitalExerciseService } from '../../services/digital-exercise.service';
import { LearningModule, LearningModulesService } from '../../services/learning-modules.service';
import { ClassRecordingsService, ClassRecording } from '../../services/class-recordings.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { AnnouncementItem, AnnouncementService } from '../../services/announcement.service';
import {
  JourneyPendingCelebrationDialogComponent,
  JourneyPendingCelebrationData
} from './journey-pending-celebration-dialog.component';

type MyCourseTab = 'classes' | 'exercises' | 'talk-buddy' | 'journey';
type JourneyFilter = 'all' | 'completed' | 'pending';
type ProgressRange = 'weekly' | 'overall';

@Component({
  selector: 'app-my-course',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    StudentMeetingsComponent,
    StudentRecordingsComponent,
    DigitalExercisesComponent,
    GluckBuddyHubComponent
  ],
  templateUrl: './my-course.component.html',
  styleUrls: ['./my-course.component.scss']
})
export class MyCourseComponent implements OnInit {
  /**
   * When false, digital learning modules are hidden everywhere in My Course
   * (journey day lists, progress donuts). Gluck Buddy (DG) remains available.
   */
  readonly showLearningModulesInJourney = false;

  /** Row placeholders for the loading skeleton (My class tab). */
  readonly skeletonMeetingRows = [0, 1, 2, 3, 4];
  readonly skeletonSideLines = [0, 1, 2];

  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;
  /** Prevents opening two celebration dialogs from overlapping refresh + init timers. */
  private journeyCongratsDialogRef: MatDialogRef<JourneyPendingCelebrationDialogComponent> | null = null;

  journey: any = null;
  loading = true;
  private _tourChecked = false;
  activeTab: MyCourseTab = 'classes';
  journeyFilter: JourneyFilter = 'all';
  journeySearch = '';
  selectedJourneyDay = 1;
  showProgressReport = false;
  progressRange: ProgressRange = 'weekly';

  private journeyDayExercises: DigitalExercise[] = [];
  private journeyDayModules: LearningModule[] = [];
  private journeyMeetings: any[] = [];
  /** Fallback when journey.profile.profilePic is empty (login/profile API often has photo). */
  private authProfilePicRaw: string | null = null;
  /** Next upcoming live class (not ended, not ongoing). */
  nextMeetingPreview: { topic: string; whenLabel: string } | null = null;

  /** Quick access: newest unlocked + not-started exercise. */
  nextNewDigitalExercise: DigitalExercise | null = null;

  /** DG Bot modules tagged to the current journey day (for completion badge). */
  private currentDayDgModules: DgModuleSummary[] = [];
  /** Manual recordings tagged to the current journey day (for completion badge). */
  private currentDayManualRecs: ClassRecording[] = [];
  /** Whether the day-completion modal is open. */
  showDayCompletionModal = false;

  latestAnnouncement: AnnouncementItem | null = null;
  announcementDismissed = false;
  announcementExpanded = false;
  loadingAnnouncement = false;
  announcementLoadError = false;
  private lastAnnouncementId: string | null = null;

  /** Full user profile from AuthService (contains subscription, role, etc.) */
  userProfile: any = null;

  private readonly motivateLines = [
    'You’re going strong — keep showing up!',
    'Small steps every day add up. Proud of you!',
    'Consistency wins. You’ve got this!',
    'Great rhythm — stay curious and keep practicing.',
    'Progress, not perfection. You’re doing really well.',
    'Every day you learn something new. Keep it up!',
    'Your future self will thank you for today’s effort.'
  ];

  /** Shown on Exercises / Modules / Journey tab row; new random line on each page load. */
  tabHeaderQuote = '';

  private readonly tabHeaderQuotes = [
    "You're doing great — keep showing up!",
    'Every bit of practice moves you forward. Stay with it!',
    'Learning a language is a marathon, not a sprint. You’ve got this.',
    'Small steps today become fluent tomorrows.',
    'Mistakes mean you’re learning. Keep going!',
    'Your effort today is building your future self.',
    'Consistency beats intensity. Proud of you for sticking with it.',
    'Curiosity + practice = progress. You’re on the right path.',
    'One lesson at a time — you’re stronger than you think.',
    'Show up, try again, celebrate small wins. That’s how winners learn.',
    'The best time to practice was yesterday; the second best is now.',
    'You don’t have to be perfect to make real progress.',
    'Every word you learn opens another door. Keep opening them!',
    'Stay patient with yourself — fluency is built brick by brick.',
    'Discipline today, confidence tomorrow.',
    'You chose growth. That already says something amazing about you.',
    'Breathe, focus, and take the next small step. That’s enough.',
    'Hard things get easier when you don’t quit. Keep pushing!',
    'Your dedication is visible, even on the days it feels invisible.',
    'Believe in the version of you who finishes what you start.'
  ];

  private pickTabHeaderQuote(): void {
    const list = this.tabHeaderQuotes;
    this.tabHeaderQuote = list[Math.floor(Math.random() * list.length)] || list[0];
  }

  constructor(
    private progressService: StudentProgressService,
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService,
    private zoomService: ZoomService,
    private exerciseService: DigitalExerciseService,
    private learningModulesService: LearningModulesService,
    private dialog: MatDialog,
    private announcementService: AnnouncementService,
    private joinClassFlow: JoinClassFlowService,
    private notify: NotificationService,
    private dgApiService: DgApiService,
    private recordingsService: ClassRecordingsService
  ) {}

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.destroyed = true);
    this.setAuthProfilePicFromUser(this.authService.getSnapshotUser());
    this.authService.currentUser$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((u) => {
        this.setAuthProfilePicFromUser(u);
        if (u) {
          this.authService.getUserProfile().subscribe({
            next: (fullU) => this.userProfile = fullU,
            error: () => {}
          });
        }
      });
    this.authService.getUserProfile().subscribe({
      next: (u) => {
        this.setAuthProfilePicFromUser(u);
        this.userProfile = u;
      },
      error: () => {}
    });

    // Instant advance: Silver GO students promoted immediately after completing all day tasks.
    this.progressService.journeyInstantAdvance$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        this.progressService.getStudentJourney().subscribe({
          next: (j) => {
            this.journey = j;
            this.loadQuickAccess();
            if (!this.journeyCongratsDialogRef) {
              const data: JourneyPendingCelebrationData = {
                currentDay: event.previousDay,
                nextDay: event.newDay,
                instant: true
              };
              const ref = this.dialog.open(JourneyPendingCelebrationDialogComponent, {
                width: '420px',
                maxWidth: '92vw',
                disableClose: false,
                autoFocus: 'first-tabbable',
                data
              });
              this.journeyCongratsDialogRef = ref;
              ref.afterClosed().subscribe(() => {
                this.journeyCongratsDialogRef = null;
              });
            }
          },
          error: () => {}
        });
      });

    // Journey first: unlock the page as soon as progress API returns (fastest paint).
    // Meetings load in parallel and patch preview when ready — avoids waiting on the slower hop.
    this.progressService
      .getStudentJourney()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (journey) => {
          this.journey = journey;
          this.loadQuickAccess();
          this.pickTabHeaderQuote();
          this.loading = false;
          setTimeout(() => this.maybeShowJourneyCongratulations(), 400);
          if (!this._tourChecked) {
            this._tourChecked = true;
            import('../../services/tour.service').then((m) => {
              const tourService = new m.TourService();
              if (!tourService.hasCompletedTour()) {
                setTimeout(() => tourService.startStudentTour(), 500);
              }
            });
          }
        },
        error: () => {
          this.pickTabHeaderQuote();
          this.loading = false;
        },
      });

    this.zoomService
      .getStudentMeetings()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => of({ success: false, data: [] }))
      )
      .subscribe({
        next: (meetings) => this.applyMeetingsPreview(meetings),
      });

    // Announcements are shown under Help & Support (messenger) → Announcements.

    this.route.queryParamMap.subscribe((q) => {
      let t = q.get('tab');
      if (t === 'modules') {
        t = 'talk-buddy';
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { tab: 'talk-buddy' },
          queryParamsHandling: 'merge',
          replaceUrl: true
        });
      }
      if ((t === 'exercises' || t === 'talk-buddy') && !this.allowsLearningContent) {
        this.activeTab = 'classes';
      } else if (t === 'exercises' || t === 'talk-buddy' || t === 'classes') {
        this.activeTab = t;
      } else if (t === 'journey') {
        this.activeTab = t;
      }
      const d = q.get('day');
      if (d && Number.isFinite(Number(d)) && Number(d) > 0) {
        this.selectedJourneyDay = Number(d);
      }
    });
  }

  private loadQuickAccess(): void {
    if (this.destroyed) return;
    this.nextNewDigitalExercise = null;
    const courseDay = this.journeyCourseDay;
    const levelRaw = this.profile?.currentLevel || this.profile?.currentLevelCode || this.profile?.level;
    const studentLevel = typeof levelRaw === 'string' ? levelRaw.split(/\s+/)[0] : '';

    // Journey Day tab data sources
    this.exerciseService
      .getExercises({ page: 1, limit: 500 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.journeyDayExercises = Array.isArray(res?.exercises) ? res.exercises : [];
        },
        error: () => {
          this.journeyDayExercises = [];
        }
      });

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

    if (studentLevel && this.showLearningModulesInJourney) {
      this.learningModulesService
        .getAccessibleModules(studentLevel, { page: 1, limit: 500 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            const modules: LearningModule[] = Array.isArray(res?.modules) ? res.modules : [];
            this.journeyDayModules = modules;
          },
          error: () => {}
        });
    } else {
      this.journeyDayModules = [];
    }

    // Fetch DG modules for the current journey day (completion badge)
    this.dgApiService
      .listStudentModules()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const all = Array.isArray(res?.modules) ? res.modules : [];
          this.currentDayDgModules = all.filter(
            (m) => Number(m.courseDay) === courseDay
          );
        },
        error: () => { this.currentDayDgModules = []; }
      });

    // Fetch manual recordings for the current journey day (completion badge)
    this.recordingsService
      .getRecordings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.currentDayManualRecs = (Array.isArray(res?.recordings) ? res.recordings : []).filter(
            (r) => Number(r.courseDay) === courseDay
          );
        },
        error: () => { this.currentDayManualRecs = []; }
      });
  }

  private loadLatestAnnouncement(): void {
    this.loadingAnnouncement = true;
    this.announcementLoadError = false;
    console.info('[my-course] loading student announcements');
    this.announcementService
      .getForStudent()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const list = Array.isArray(res?.data) ? res.data : [];
          const nextAnnouncement = list[0] || null;
          const nextId = nextAnnouncement?._id || null;
          if (nextId && nextId !== this.lastAnnouncementId) {
            this.announcementDismissed = false;
          }
          this.latestAnnouncement = nextAnnouncement;
          this.lastAnnouncementId = nextId;
          this.loadingAnnouncement = false;
          console.info('[my-course] student announcements loaded', {
            total: list.length,
            latestAnnouncementId: nextId
          });
        },
        error: (err) => {
          this.latestAnnouncement = null;
          this.loadingAnnouncement = false;
          this.announcementLoadError = true;
          console.error('[my-course] failed to load student announcements', err);
        }
      });
  }

  dismissAnnouncement(): void {
    this.announcementDismissed = true;
    this.announcementExpanded = false;
  }

  expandAnnouncement(): void {
    this.announcementExpanded = true;
  }

  closeAnnouncementModal(): void {
    this.announcementExpanded = false;
  }

  openAnnouncementsPage(): void {
    this.router.navigate(['/student/announcements']);
  }

  private getPublishedTs(item: any): number {
    const raw = item?.publishedAt || item?.createdAt;
    const t = raw ? new Date(raw).getTime() : NaN;
    return Number.isFinite(t) ? t : 0;
  }

  get updatesPrimaryTab(): MyCourseTab {
    if (!this.allowsLearningContent) return 'classes';
    if (this.nextNewDigitalExercise || this.nextLockedDigitalExercise) return 'exercises';
    return 'exercises';
  }

  get updatesLinkText(): string {
    if (!this.allowsLearningContent) return 'Go to classes';
    return 'Go to exercises';
  }

  setTab(tab: MyCourseTab): void {
    if (!this.allowsLearningContent && (tab === 'exercises' || tab === 'talk-buddy')) {
      tab = 'classes';
    }
    this.activeTab = tab;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
    if (tab === 'classes') {
      this.refreshJourneyForPendingCelebration();
    }
  }

  /** Refetch journey so attendance → pending flags show in Updates + dialog. */
  refreshJourneyForPendingCelebration(): void {
    this.progressService
      .getStudentJourney()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (j) => {
          this.journey = j;
          this.loadQuickAccess();
          setTimeout(() => this.maybeShowJourneyCongratulations(), 350);
        },
        error: () => {}
      });
  }

  get nextJourneyPreviewDay(): number {
    return Math.min(200, this.journeyCourseDay + 1);
  }

  get showJourneyPendingCelebration(): boolean {
    return !!this.profile?.pendingJourneyDayAdvance;
  }

  private maybeShowJourneyCongratulations(): void {
    if (this.destroyed || !this.showJourneyPendingCelebration || this.activeTab !== 'classes') return;
    if (this.journeyCongratsDialogRef) return;
    const reg = (this.profile?.regNo || this.profile?.name || 'student').toString();
    const forDay = this.profile?.pendingJourneyDayAdvanceForDay ?? this.journeyCourseDay;
    const key = `journeyCongratsDlg_${reg}_${forDay}`;
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(key)) return;
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, '1');

    const data: JourneyPendingCelebrationData = {
      currentDay: this.journeyCourseDay,
      nextDay: this.nextJourneyPreviewDay
    };
    const ref = this.dialog.open(JourneyPendingCelebrationDialogComponent, {
      width: '400px',
      maxWidth: '92vw',
      disableClose: false,
      autoFocus: 'first-tabbable',
      data
    });
    this.journeyCongratsDialogRef = ref;
    ref.afterClosed().subscribe(() => {
      this.journeyCongratsDialogRef = null;
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

  /** Full display name for compact tab header card. */
  get studentDisplayName(): string {
    const name = (this.profile?.name || '').trim();
    if (name) return name;
    const auth = (this.authService.getSnapshotUser()?.name || '').trim();
    return auth || 'Student';
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

  /** Silver GO (and other GO-tagged students) see journey-day recordings on the Journey tab. */
  get isGoBatchStudent(): boolean {
    const u = this.authService.getSnapshotUser();
    return String(u?.goStatus || '').toUpperCase() === 'GO';
  }

  /**
   * True only for Silver GO students (subscription === SILVER AND goStatus === GO).
   * These students must complete all recordings, exercises, and DG bot before advancing.
   */
  get isSilverGoStudentFrontend(): boolean {
    const u = this.authService.getSnapshotUser();
    const goOk = String(u?.goStatus || '').toUpperCase() === 'GO';
    const sub = String(
      this.userProfile?.subscription || this.profile?.subscription || u?.subscription || ''
    ).toUpperCase();
    return goOk && sub === 'SILVER';
  }

  /**
   * True when a Silver GO student has completed every content item tagged to the current day
   * (recordings, exercises, DG bot) and is therefore eligible for midnight promotion.
   */
  get showSilverDayCompletePromotion(): boolean {
    return this.isSilverGoStudentFrontend && this.isDayComplete && this.journeyCourseDay < 200;
  }

  get allowsLearningContent(): boolean {
    return this.profile?.learningContentEnabled !== false;
  }

  get journeyCourseDay(): number {
    const d = this.profile?.currentCourseDay;
    if (d == null || !Number.isFinite(Number(d))) return 1;
    return Math.min(200, Math.max(1, Math.floor(Number(d))));
  }

  get journeyDays(): number[] {
    const n = this.journeyCourseDay;
    return Array.from({ length: n }, (_, i) => i + 1);
  }

  get filteredJourneyDays(): number[] {
    const q = this.journeySearch.trim().toLowerCase();
    if (!q) return this.journeyDays;
    return this.journeyDays.filter((d) => String(d).includes(q));
  }

  selectJourneyDay(day: number): void {
    this.selectedJourneyDay = day;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: 'journey', day },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  openProgressReport(): void {
    this.showProgressReport = true;
  }

  closeProgressReport(): void {
    this.showProgressReport = false;
  }

  toggleProgressReport(): void {
    this.showProgressReport = !this.showProgressReport;
  }

  openPerformanceHistory(): void {
    this.router.navigate(['/performance-history']);
  }

  setProgressRange(range: ProgressRange): void {
    this.progressRange = range;
  }

  private exerciseDone(ex: DigitalExercise): boolean {
    return !!ex?.studentAttempt;
  }

  private moduleDone(mod: LearningModule): boolean {
    const st = mod?.studentProgress?.status;
    return st === 'completed';
  }

  get selectedDayExercises(): DigitalExercise[] {
    let list = this.journeyDayExercises.filter((ex) => Number(ex.courseDay || 0) === this.selectedJourneyDay);
    if (this.journeyFilter === 'completed') list = list.filter((x) => this.exerciseDone(x));
    if (this.journeyFilter === 'pending') list = list.filter((x) => !this.exerciseDone(x));
    return list;
  }

  get selectedDayModules(): LearningModule[] {
    if (!this.showLearningModulesInJourney) return [];
    let list = this.journeyDayModules.filter((m) => Number((m as any).courseDay || 0) === this.selectedJourneyDay);
    if (this.journeyFilter === 'completed') list = list.filter((x) => this.moduleDone(x));
    if (this.journeyFilter === 'pending') list = list.filter((x) => !this.moduleDone(x));
    return list;
  }

  get selectedDayHasItems(): boolean {
    return this.selectedDayExercises.length > 0 || this.selectedDayModules.length > 0;
  }

  get selectedDayCompletedCount(): number {
    return this.selectedDayExercises.filter((x) => this.exerciseDone(x)).length +
      this.selectedDayModules.filter((x) => this.moduleDone(x)).length;
  }

  get selectedDayTotalCount(): number {
    return this.selectedDayExercises.length + this.selectedDayModules.length;
  }

  // ── Day completion badge ────────────────────────────────────────────────────

  private recordingWatched(r: ClassRecording): boolean {
    const totalSec = Number(r.duration ?? 0);
    const rawWatched = Math.max(0, Math.round(Number(r.watchedSeconds ?? 0)));
    const watchedSec = totalSec > 0 ? Math.min(rawWatched, totalSec) : rawWatched;
    return totalSec > 0 && watchedSec >= Math.ceil(totalSec * 0.75);
  }

  /** Exercises tagged to the current journey day. */
  get currentDayExercisesForBadge(): DigitalExercise[] {
    return this.journeyDayExercises.filter(
      (ex) => Number(ex.courseDay) === this.journeyCourseDay
    );
  }

  get currentDayIncompleteExercises(): DigitalExercise[] {
    return this.currentDayExercisesForBadge.filter((ex) => !this.exerciseDone(ex));
  }

  get currentDayIncompleteDg(): DgModuleSummary[] {
    return this.currentDayDgModules.filter((m) => !m.studentProgress?.completed);
  }

  get currentDayIncompleteRecs(): ClassRecording[] {
    return this.currentDayManualRecs.filter((r) => !this.recordingWatched(r));
  }

  /** True when at least one content item is tagged to the current day. */
  get dayHasTrackableContent(): boolean {
    return (
      this.currentDayExercisesForBadge.length > 0 ||
      this.currentDayDgModules.length > 0 ||
      this.currentDayManualRecs.length > 0
    );
  }

  /** True when all content for the current journey day is completed. */
  get isDayComplete(): boolean {
    if (!this.dayHasTrackableContent) return false;
    return (
      this.currentDayIncompleteExercises.length === 0 &&
      this.currentDayIncompleteDg.length === 0 &&
      this.currentDayIncompleteRecs.length === 0
    );
  }

  openDayCompletionModal(): void {
    this.showDayCompletionModal = true;
  }

  closeDayCompletionModal(): void {
    this.showDayCompletionModal = false;
  }

  openExercise(ex: DigitalExercise): void {
    if (!ex?._id) return;
    this.router.navigate(['/digital-exercises', ex._id, 'play']);
  }

  openModule(mod: LearningModule): void {
    if (!mod?._id) return;
    this.router.navigate(['/ai-tutor-chat'], {
      queryParams: {
        moduleId: mod._id,
        returnUrl: this.router.url   // return to current journey/day page
      }
    });
  }

  getExerciseHoverDetails(ex: DigitalExercise): string {
    const status = this.exerciseDone(ex) ? 'Completed' : 'Not completed';
    const day = Number.isFinite(Number(ex?.courseDay)) ? `Day ${ex.courseDay}` : 'No fixed day';
    return `${day} | ${ex?.level || 'Level N/A'} | ${ex?.category || 'General'} | ${status}`;
  }

  getModuleHoverDetails(mod: LearningModule): string {
    const status = this.moduleDone(mod) ? 'Completed' : 'Not completed';
    const day = Number.isFinite(Number((mod as any)?.courseDay)) ? `Day ${(mod as any).courseDay}` : 'No fixed day';
    return `${day} | ${mod?.level || 'Level N/A'} | ${mod?.category || 'General'} | ${status}`;
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
    if (!res?.success || !Array.isArray(res.data)) {
      this.journeyMeetings = [];
      return;
    }
    this.journeyMeetings = res.data;
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

  private getMeetingJourneyDay(meeting: any): number | null {
    const direct = Number(meeting?.courseDay);
    if (Number.isFinite(direct) && direct >= 1 && direct <= 200) return direct;

    const topic = String(meeting?.topic || '');
    const m = topic.match(/\bday\s*[:\-]?\s*(\d{1,3})\b/i);
    if (!m) return null;
    const parsed = Number(m[1]);
    return Number.isFinite(parsed) && parsed >= 1 && parsed <= 200 ? parsed : null;
  }

  private matchesSelectedJourneyDay(meeting: any): boolean {
    return this.getMeetingJourneyDay(meeting) === this.selectedJourneyDay;
  }

  get selectedDayUpcomingClasses(): any[] {
    return this.journeyMeetings.filter((m) => this.matchesSelectedJourneyDay(m) && !m.isOngoing && !m.hasEnded);
  }

  get selectedDayLiveClasses(): any[] {
    return this.journeyMeetings.filter((m) => this.matchesSelectedJourneyDay(m) && !!m.isOngoing);
  }

  get selectedDayAttemptedClasses(): any[] {
    return this.journeyMeetings.filter((m) => this.matchesSelectedJourneyDay(m) && !!m.hasEnded);
  }

  get selectedDayAllClasses(): any[] {
    const toTs = (v: any) => {
      const t = new Date(v?.startTime || 0).getTime();
      return Number.isFinite(t) ? t : 0;
    };
    return [...this.selectedDayLiveClasses, ...this.selectedDayUpcomingClasses, ...this.selectedDayAttemptedClasses]
      .sort((a, b) => toTs(a) - toTs(b));
  }

  private isInWeeklyJourneyWindow(day: number | null | undefined): boolean {
    if (!Number.isFinite(Number(day))) return false;
    const d = Number(day);
    const min = Math.max(1, this.journeyCourseDay - 6);
    return d >= min && d <= this.journeyCourseDay;
  }

  private isInWeeklyDateWindow(raw: any): boolean {
    const t = new Date(raw).getTime();
    if (!Number.isFinite(t)) return false;
    const now = new Date();
    const from = new Date();
    from.setDate(now.getDate() - 6);
    from.setHours(0, 0, 0, 0);
    return t >= from.getTime() && t <= now.getTime();
  }

  private get progressExercisesList(): DigitalExercise[] {
    if (this.progressRange === 'overall') return this.journeyDayExercises;
    return this.journeyDayExercises.filter((ex) => this.isInWeeklyJourneyWindow(ex.courseDay));
  }

  private get progressModulesList(): LearningModule[] {
    if (!this.showLearningModulesInJourney) return [];
    if (this.progressRange === 'overall') return this.journeyDayModules;
    return this.journeyDayModules.filter((m: any) => this.isInWeeklyJourneyWindow(m?.courseDay));
  }

  private get progressClassesList(): any[] {
    if (this.progressRange === 'overall') return this.journeyMeetings;
    return this.journeyMeetings.filter((m) => this.isInWeeklyDateWindow(m?.startTime));
  }

  get progressExercisesTotal(): number {
    return this.progressExercisesList.length;
  }

  get progressExercisesDone(): number {
    return this.progressExercisesList.filter((x) => this.exerciseDone(x)).length;
  }

  get progressModulesTotal(): number {
    return this.progressModulesList.length;
  }

  get progressModulesDone(): number {
    return this.progressModulesList.filter((x) => this.moduleDone(x)).length;
  }

  get progressClassesTotal(): number {
    return this.progressClassesList.length;
  }

  get progressClassesDone(): number {
    return this.progressClassesList.filter((m) => !!m?.hasEnded).length;
  }

  private ratioPct(done: number, total: number): number {
    if (!total) return 0;
    return Math.round((done / total) * 100);
  }

  get progressExercisesPct(): number {
    return this.ratioPct(this.progressExercisesDone, this.progressExercisesTotal);
  }

  get progressModulesPct(): number {
    return this.ratioPct(this.progressModulesDone, this.progressModulesTotal);
  }

  get progressClassesPct(): number {
    return this.ratioPct(this.progressClassesDone, this.progressClassesTotal);
  }

  get progressOverallDone(): number {
    return this.progressExercisesDone + this.progressModulesDone + this.progressClassesDone;
  }

  get progressOverallTotal(): number {
    return this.progressExercisesTotal + this.progressModulesTotal + this.progressClassesTotal;
  }

  get progressOverallPct(): number {
    return this.ratioPct(this.progressOverallDone, this.progressOverallTotal);
  }

  /** Rows shown on progress report cards (hover details) — same scope as counts/% . */
  get progressReportMeetings(): any[] {
    return this.progressClassesList;
  }

  get progressReportModules(): LearningModule[] {
    return this.progressModulesList;
  }

  get progressReportExercises(): DigitalExercise[] {
    return this.progressExercisesList;
  }

  meetingJourneyDayLabel(meeting: any): string {
    const d = this.getMeetingJourneyDay(meeting);
    return d != null ? `Day ${d}` : '—';
  }

  meetingProgressStatusLabel(meeting: any): string {
    if (meeting?.hasEnded) return this.getMeetingAttendanceStatus(meeting);
    return this.getMeetingStateLabel(meeting);
  }

  formatMeetingDate(date: any): string {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  formatMeetingTime(date: any): string {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatMeetingDuration(minutes: number): string {
    const mins = Number(minutes) || 0;
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    return hours > 0 ? `${hours}h ${rem}m` : `${rem} min`;
  }

  getMeetingTimeUntilStart(meeting: any): string {
    const raw = Number(meeting?.timeUntilStart);
    if (!Number.isFinite(raw) || raw <= 0) return 'Starting soon';
    const minutes = Math.floor(raw / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `in ${days} day${days > 1 ? 's' : ''}`;
    if (hours > 0) return `in ${hours} hour${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `in ${minutes} minute${minutes > 1 ? 's' : ''}`;
    return 'Starting soon';
  }

  joinSelectedDayMeeting(meeting: any): void {
    if (meeting?.joinUrl && (meeting?.canJoin || meeting?.isOngoing)) {
      this.joinClassFlow.openJoin(meeting, (msg) => this.notify.error(msg));
    }
  }

  getMeetingAttendancePercent(meeting: any): number {
    const total = Number(meeting?.duration || 0);
    if (!meeting?.hasEnded || total <= 0) return 0;
    const attendedMin = Number(meeting?.attendedDurationMinutes ?? meeting?.durationMinutes ?? 0);
    if (meeting?.attended === true && attendedMin <= 0) {
      return 100;
    }
    const pct = Math.round((attendedMin / total) * 100);
    return Math.max(0, Math.min(100, pct));
  }

  getMeetingAttendanceStatus(meeting: any): 'Attended' | 'Not Attended' | 'Missed' {
    if (meeting?.attended === true) return 'Attended';
    const pct = this.getMeetingAttendancePercent(meeting);
    if (pct >= 75) return 'Attended';
    if (meeting?.hasEnded && pct > 0) return 'Not Attended';
    return 'Missed';
  }

  getMeetingStateLabel(meeting: any): 'Live' | 'Upcoming' | 'Attempted' {
    if (meeting?.isOngoing) return 'Live';
    if (meeting?.hasEnded) return 'Attempted';
    return 'Upcoming';
  }

}
