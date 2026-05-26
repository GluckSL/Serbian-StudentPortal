import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import {
  StudentJourneyDetailModalComponent,
  StudentJourneyPreview
} from '../student-journey-detail-modal/student-journey-detail-modal.component';
import { NotificationService } from '../../../services/notification.service';

interface LearningDayRow {
  day: number;
  level: string;
  blocked: boolean;
  modules: number;
  exercises: number;
  dgModules: number;
  recordings: number;
}

interface LevelSegment {
  level: string;
  dayStart: number;
  dayEnd: number;
  blocked: boolean;
}

@Component({
  selector: 'app-admin-student-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, StudentJourneyDetailModalComponent],
  templateUrl: './admin-student-detail.component.html',
  styleUrls: ['./admin-student-detail.component.css']
})
export class AdminStudentDetailComponent implements OnInit {
  studentId = '';
  studentName = '';
  preview: StudentJourneyPreview | null = null;
  activeTab: 'overview' | 'learning' = 'overview';

  learningLoading = false;
  learningError = '';
  learningProfile: any = null;
  learningDays: LearningDayRow[] = [];
  levelSegments: LevelSegment[] = [];
  blockedLevels: string[] = [];
  savingBlocks = false;
  selectedDay: LearningDayRow | null = null;
  levelFilter = 'ALL';

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      this.studentId = params.get('studentId') || '';
      this.loadQueryPreview();
      if (this.activeTab === 'learning') {
        this.loadLearning();
      }
    });
    this.route.queryParamMap.subscribe(() => this.loadQueryPreview());
  }

  get avatarInitial(): string {
    return (this.studentName || '?').charAt(0).toUpperCase();
  }

  get filteredDays(): LearningDayRow[] {
    if (this.levelFilter === 'ALL') return this.learningDays;
    return this.learningDays.filter((d) => d.level === this.levelFilter);
  }

  get blockedDayCount(): number {
    return this.learningDays.filter((d) => d.blocked).length;
  }

  get totalContentCount(): number {
    return this.learningDays.reduce(
      (s, d) => s + d.modules + d.exercises + d.dgModules + d.recordings,
      0
    );
  }

  private loadQueryPreview(): void {
    const q = this.route.snapshot.queryParamMap;
    this.studentName = q.get('name') || this.studentName || '';
    this.preview = {
      email: q.get('email') || undefined,
      subscription: q.get('subscription') || undefined,
      medium: q.get('medium') || undefined,
      level: q.get('level') || undefined,
      regNo: q.get('regNo') || undefined,
      batch: q.get('batch') || undefined
    };
  }

  setTab(tab: 'overview' | 'learning'): void {
    this.activeTab = tab;
    if (tab === 'learning' && !this.learningDays.length && !this.learningLoading) {
      this.loadLearning();
    }
  }

  loadLearning(): void {
    if (!this.studentId) return;
    this.learningLoading = true;
    this.learningError = '';
    this.http
      .get<{
        profile: any;
        days: LearningDayRow[];
        levelSegments: LevelSegment[];
      }>(`/api/student-progress/admin/students/${this.studentId}/learning-overview`)
      .subscribe({
        next: (res) => {
          this.learningProfile = res.profile;
          this.learningDays = res.days || [];
          this.levelSegments = res.levelSegments || [];
          this.blockedLevels = [...(res.profile?.blockedJourneyLevels || [])];
          if (!this.studentName && res.profile?.name) {
            this.studentName = res.profile.name;
          }
          if (res.profile) {
            this.preview = {
              email: res.profile.email,
              subscription: res.profile.subscription,
              medium: res.profile.medium,
              level: res.profile.level,
              regNo: res.profile.regNo,
              batch: res.profile.batch
            };
          }
          this.learningLoading = false;
        },
        error: () => {
          this.learningLoading = false;
          this.learningError = 'Could not load learning journey.';
        }
      });
  }

  isLevelBlocked(level: string): boolean {
    return this.blockedLevels.includes(level);
  }

  toggleLevelBlock(level: string): void {
    const next = this.isLevelBlocked(level)
      ? this.blockedLevels.filter((l) => l !== level)
      : [...this.blockedLevels, level];
    this.saveBlockedLevels(next);
  }

  blockA1ForA2Starter(): void {
    const next = this.isLevelBlocked('A1')
      ? this.blockedLevels.filter((l) => l !== 'A1')
      : [...new Set([...this.blockedLevels, 'A1'])];
    this.saveBlockedLevels(next);
  }

  private saveBlockedLevels(levels: string[]): void {
    if (!this.studentId || this.savingBlocks) return;
    this.savingBlocks = true;
    this.http
      .patch<{ student?: { blockedJourneyLevels?: string[] } }>(
        `/api/student-progress/admin/students/${this.studentId}/blocked-journey-levels`,
        { blockedJourneyLevels: levels }
      )
      .subscribe({
        next: (res) => {
          this.blockedLevels = res.student?.blockedJourneyLevels || levels;
          this.savingBlocks = false;
          const blockedA1 = this.isLevelBlocked('A1');
          this.notify.success(
            blockedA1
              ? 'A1 content blocked (days 1–42) for this student.'
              : 'Content blocks updated.'
          );
          this.loadLearning();
        },
        error: () => {
          this.savingBlocks = false;
          this.notify.error('Failed to update content blocks.');
        }
      });
  }

  selectDay(day: LearningDayRow): void {
    this.selectedDay = this.selectedDay?.day === day.day ? null : day;
  }

  isCurrentDay(day: number): boolean {
    return Number(this.learningProfile?.currentCourseDay) === day;
  }

  setLevelFilter(level: string): void {
    this.levelFilter = level;
    this.selectedDay = null;
  }
}
