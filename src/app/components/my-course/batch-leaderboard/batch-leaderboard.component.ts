import { Component, OnInit, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  BatchLeaderboardService,
  BatchLeaderboardResponse,
  LeaderboardEntry,
  LeaderboardPeriod,
  TodayTasks,
} from '../../../services/batch-leaderboard.service';
import { catchError, of } from 'rxjs';

type SubTab = 'today' | 'weekly' | 'overall';

@Component({
  selector: 'app-batch-leaderboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './batch-leaderboard.component.html',
  styleUrls: ['./batch-leaderboard.component.scss'],
})
export class BatchLeaderboardComponent implements OnInit, OnChanges {
  @Input() active = false;
  @Input() requestedPeriod: LeaderboardPeriod | null = null;

  subTab: SubTab = 'weekly';
  loading = false;
  error = '';
  data: BatchLeaderboardResponse | null = null;
  private _cache: Partial<Record<SubTab, BatchLeaderboardResponse>> = {};

  constructor(private svc: BatchLeaderboardService) {}

  ngOnInit(): void {
    if (this.requestedPeriod) {
      this.setSubTab(this.requestedPeriod as SubTab);
    } else if (this.active) {
      this.load(this.subTab);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['requestedPeriod']?.currentValue) {
      this.setSubTab(changes['requestedPeriod'].currentValue as SubTab);
    } else if (changes['active']?.currentValue === true && !this._cache[this.subTab]) {
      this.load(this.subTab);
    }
  }

  setSubTab(tab: SubTab): void {
    this.subTab = tab;
    const cached = this._cache[tab];
    if (cached) {
      this.data = cached;
      this.error = '';
      return;
    }
    this.load(tab);
  }

  reload(): void {
    delete this._cache[this.subTab];
    this.load(this.subTab);
  }

  private load(period: LeaderboardPeriod): void {
    this.loading = true;
    this.error = '';
    this.svc
      .getLeaderboard(period)
      .pipe(catchError(() => of(null)))
      .subscribe((res) => {
        this.loading = false;
        if (!res) { this.error = 'Could not load leaderboard. Please try again.'; return; }
        this.data = res;
        this._cache[period] = res;
      });
  }

  get leaderboard(): LeaderboardEntry[] {
    return this.data?.leaderboard ?? [];
  }

  /** Only show entries that have some activity — students shouldn't see inactives */
  get visibleLeaderboard(): LeaderboardEntry[] {
    const all = this.leaderboard;
    const active = all.filter(e => e.engagementMinutes > 0);
    // Always include the current student even if inactive
    const myId = this.myStats?.studentId;
    if (myId && !active.find(e => e.studentId === myId)) {
      const me = all.find(e => e.studentId === myId);
      if (me) active.push(me);
    }
    return active;
  }

  get myRank(): number | null { return this.data?.myRank ?? null; }
  get myStats(): LeaderboardEntry | null { return this.data?.myStats ?? null; }
  get batch(): string { return this.data?.batch ?? ''; }
  get batchmates(): number { return this.data?.batchmates ?? 0; }
  get todayTasks(): TodayTasks | null { return this.data?.todayTasks ?? null; }

  /** Task cards always shown — Day {{ courseDay }} tasks */
  get taskCards(): { key: string; label: string; icon: string; done: number; total: number; tone: string }[] {
    const t = this.todayTasks;
    const live = t?.liveClasses ?? { done: 0, total: 0 };
    const ex = t?.exercises ?? { done: 0, total: 0 };
    const buddy = t?.gluckBuddy ?? { done: 0, total: 0 };
    const ar = t?.arena ?? { done: 0, total: 0 };
    return [
      { key: 'live', label: 'Live', icon: '🎥', done: live.done, total: live.total, tone: 'blue' },
      { key: 'exercises', label: 'Exercises', icon: '📚', done: ex.done, total: ex.total, tone: 'green' },
      { key: 'buddy', label: 'Glück Buddy', icon: '🎙️', done: buddy.done, total: buddy.total, tone: 'purple' },
      { key: 'arena', label: 'Arena', icon: '⚡', done: ar.done, total: ar.total, tone: 'amber' },
    ];
  }

  isTaskComplete(card: { done: number; total: number }): boolean {
    return card.total > 0 && card.done >= card.total;
  }

  formatTaskRatio(card: { done: number; total: number }): string {
    return `${card.done}/${card.total}`;
  }

  /** Compact task chips for leaderboard rows (mobile). Full breakdown for current user. */
  getEntryTaskChips(entry: LeaderboardEntry): {
    key: string;
    icon: string;
    text: string;
    tone: string;
    done: boolean;
  }[] {
    const isMe = entry.studentId === this.myStats?.studentId;
    if (isMe && this.todayTasks) {
      return this.taskCards.map((card) => ({
        key: card.key,
        icon: card.icon,
        text: this.formatTaskRatio(card),
        tone: card.tone,
        done: this.isTaskComplete(card),
      }));
    }

    const chips: {
      key: string;
      icon: string;
      text: string;
      tone: string;
      done: boolean;
    }[] = [];

    if (entry.exercisesTotal > 0 || entry.exercisesCompleted > 0) {
      chips.push({
        key: 'exercises',
        icon: '📚',
        text: `${entry.exercisesCompleted}/${entry.exercisesTotal}`,
        tone: 'green',
        done: entry.exercisesTotal > 0 && entry.exercisesCompleted >= entry.exercisesTotal,
      });
    }

    if (entry.dgSessionsCompleted > 0) {
      chips.push({
        key: 'buddy',
        icon: '🎙️',
        text: `${entry.dgSessionsCompleted}`,
        tone: 'purple',
        done: false,
      });
    }

    if (entry.arenaXp > 0) {
      chips.push({
        key: 'arena',
        icon: '⚡',
        text: `${Math.floor(entry.arenaXp / 10)}`,
        tone: 'amber',
        done: false,
      });
    }

    return chips;
  }

  get taskSectionLabel(): string {
    const p = this.todayTasks?.period ?? this.subTab;
    if (p === 'weekly') return 'This week\'s tasks';
    if (p === 'overall') return 'Overall progress';
    const day = this.todayTasks?.courseDay ?? this.myStats?.currentCourseDay ?? '';
    return `Day ${day} tasks`;
  }

  /** How many engagement minutes needed to reach the rank above */
  get minutesToRankUp(): number | null {
    if (!this.myStats || !this.myRank || this.myRank <= 1) return null;
    const above = this.leaderboard.find(e => e.rank === this.myRank! - 1);
    if (!above) return null;
    if (above.engagementMinutes > this.myStats.engagementMinutes) {
      return above.engagementMinutes - this.myStats.engagementMinutes + 1;
    }
    const myPct = this.exerciseCompletionPercent(this.myStats);
    const abovePct = this.exerciseCompletionPercent(above);
    if (abovePct > myPct) return null;
    return null;
  }

  /** Progress toward rank-up based on engagement time (0–100) */
  get rankUpProgress(): number {
    if (!this.myStats || !this.myRank || this.myRank <= 1) return 100;
    const above = this.leaderboard.find(e => e.rank === this.myRank! - 1);
    if (!above || above.engagementMinutes <= 0) return 100;
    return Math.min(100, Math.round((this.myStats.engagementMinutes / above.engagementMinutes) * 100));
  }

  get myEngagementLabel(): string {
    return this.formatEngagementMinutes(this.myStats?.engagementMinutes ?? 0);
  }

  get activeMatesCount(): number {
    return this.leaderboard.filter(e => e.engagementMinutes > 0).length;
  }

  get activeMatesLabel(): string {
    if (this.subTab === 'today') return `${this.activeMatesCount} batchmate${this.activeMatesCount === 1 ? '' : 's'} learning today`;
    if (this.subTab === 'weekly') return `${this.activeMatesCount} batchmate${this.activeMatesCount === 1 ? '' : 's'} learning this week`;
    return `${this.activeMatesCount} batchmate${this.activeMatesCount === 1 ? '' : 's'} learning overall`;
  }

  formatEngagementMinutes(minutes: number): string {
    const mins = Math.max(0, Math.round(minutes || 0));
    if (mins <= 0) return '0m';
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m ? `${h}h ${m}m` : `${h}h`;
    }
    return `${mins}m`;
  }

  exerciseCompletionPercent(entry: LeaderboardEntry): number {
    const total = entry.exercisesTotal ?? 0;
    const done = entry.exercisesCompleted ?? 0;
    if (total <= 0) return 0;
    return Math.round((done / total) * 100);
  }

  formatExerciseCompletion(entry: LeaderboardEntry): string {
    const total = entry.exercisesTotal ?? 0;
    const done = entry.exercisesCompleted ?? 0;
    if (total <= 0) return '—';
    return `${done}/${total} (${this.exerciseCompletionPercent(entry)}%)`;
  }

  getRankMedal(rank: number): string {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return '';
  }

  getActivityLabel(entry: LeaderboardEntry): string {
    const parts: string[] = [];

    if (entry.engagementMinutes > 0) {
      parts.push(`${this.formatEngagementMinutes(entry.engagementMinutes)} learning`);
    }

    if (entry.exercisesTotal > 0) {
      parts.push(`${this.formatExerciseCompletion(entry)} exercises`);
    } else if (entry.exercisesCompleted > 0) {
      parts.push(`${entry.exercisesCompleted} exercise${entry.exercisesCompleted > 1 ? 's' : ''} done`);
    }

    if (parts.length) return parts.join(' · ');
    if (entry.loggedToday) return 'Checked in · no learning time yet';
    return 'Getting started';
  }

  getRankUpHint(): string | null {
    if (!this.myStats || !this.myRank || this.myRank <= 1) return null;
    const above = this.leaderboard.find(e => e.rank === this.myRank! - 1);
    if (!above) return null;

    const mins = this.minutesToRankUp;
    if (mins != null && mins > 0) {
      return `+${this.formatEngagementMinutes(mins)} learning to reach #${this.myRank - 1}`;
    }

    const myPct = this.exerciseCompletionPercent(this.myStats);
    const abovePct = this.exerciseCompletionPercent(above);
    if (this.myStats.engagementMinutes === above.engagementMinutes && abovePct > myPct) {
      return `Complete more exercises to reach #${this.myRank - 1}`;
    }

    return `Keep learning to reach #${this.myRank - 1}`;
  }

  getStatusBadge(entry: LeaderboardEntry): { label: string; cls: string } | null {
    const avg = entry.averageScore ?? 0;
    const active = entry.engagementMinutes > 0;

    if (this.subTab === 'today') {
      if (entry.rank === 1 && active) return { label: 'Topper', cls: 'badge--champion' };
      if (entry.rank === 2 && active) return { label: 'Star', cls: 'badge--star' };
      if (entry.rank === 3 && active) return { label: 'Rising star', cls: 'badge--star' };
      if (avg >= 85 && entry.exercisesCompleted > 0) return { label: 'Sharp mind', cls: 'badge--mind' };
      if (entry.exercisesCompleted > 0 && entry.dgSessionsCompleted > 0) return { label: 'All-rounder', cls: 'badge--step' };
      if (entry.exercisesCompleted > 0) return { label: 'Go getter', cls: 'badge--task' };
      if (entry.dgSessionsCompleted > 0) return { label: 'Speaker pro', cls: 'badge--task' };
      if (entry.arenaXp > 0) return { label: 'Arena ace', cls: 'badge--arena' };
      if (entry.loggedToday) return { label: 'On track', cls: 'badge--neutral' };
    } else if (this.subTab === 'weekly') {
      if (entry.rank === 1 && active) return { label: 'Week champion', cls: 'badge--champion' };
      if (entry.currentStreak >= 5) return { label: 'On fire', cls: 'badge--streak' };
      if (avg >= 80) return { label: 'Consistent', cls: 'badge--mind' };
      if (active) return { label: 'Keep going', cls: 'badge--step' };
    } else {
      if (entry.rank === 1) return { label: 'Batch legend', cls: 'badge--champion' };
      if (entry.rank === 2) return { label: 'Elite', cls: 'badge--star' };
      if (entry.rank === 3) return { label: 'Top tier', cls: 'badge--star' };
      if (entry.currentCourseDay >= 100) return { label: 'Veteran', cls: 'badge--step' };
      if (avg >= 75) return { label: 'Strong', cls: 'badge--mind' };
    }
    return null;
  }

  /* ── Podium helpers ─────────────────────────────────────────────────── */
  get topThree(): LeaderboardEntry[] {
    return this.leaderboard.filter(e => e.rank >= 1 && e.rank <= 3);
  }

  podiumInitial(entry: LeaderboardEntry | null): string {
    return entry?.name?.charAt(0)?.toUpperCase() ?? '-';
  }

  podiumScore(entry: LeaderboardEntry | null): string | number {
    return entry?.totalPoints ?? entry?.engagementMinutes ?? '-';
  }

  podiumAvatarUrl(entry: LeaderboardEntry | null): string {
    return entry?.profilePic ?? '';
  }

  subTabs: SubTab[] = ['today', 'weekly', 'overall'];
  getSubTabLabel(tab: SubTab): string {
    return tab === 'today' ? 'Today' : tab === 'weekly' ? 'This Week' : 'Overall';
  }

  trackByStudentId(_: number, entry: LeaderboardEntry): string {
    return entry.studentId;
  }
}
