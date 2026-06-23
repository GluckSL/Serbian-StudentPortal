import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../../../shared/material.module';
import { AuthService } from '../../../services/auth.service';
import { NavService } from '../../../shared/services/nav.service';
import { ClassRecordingsService } from '../../../services/class-recordings.service';
import {
  RecordingAccessRequestService,
  PendingRequest,
  ReviewedRequest,
  RequestHistoryCounts,
} from '../../../services/recording-access-request.service';

type ApprovalTab = 'pending' | 'history' | 'ready';

@Component({
  selector: 'app-recording-access-approval-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule, RouterModule],
  templateUrl: './recording-access-approval-page.component.html',
  styleUrls: ['./recording-access-approval-page.component.scss'],
})
export class RecordingAccessApprovalPageComponent implements OnInit, OnDestroy {
  activeTab: ApprovalTab = 'pending';
  requests: PendingRequest[] = [];
  historyRequests: ReviewedRequest[] = [];
  historyCounts: RequestHistoryCounts | null = null;
  historyStatusFilter: '' | 'APPROVED' | 'DECLINED' = '';
  batchFilter = '';
  historyPage = 1;
  historyTotal = 0;
  readonly historyPageSize = 50;
  loading = false;
  historyLoading = false;
  error = '';
  historyError = '';
  busyId: string | null = null;
  declineTarget: PendingRequest | null = null;
  declineReason = '';
  readonly skeletonRows = [0, 1, 2, 3, 4];
  canBackfill = false;
  /** Approve / decline / backfill (SUB_ADMIN needs Class Recordings edit access). */
  canManageApprovals = false;
  /** Per-row status while backfill runs */
  rowStatus: Record<string, string> = {};
  private rowBackfillMode: 'backfill' | 'backfill-approve' | null = null;
  private approveAfterBackfillId: string | null = null;
  private backfillPollTimer: ReturnType<typeof setInterval> | null = null;
  private backfillPollRequestId: string | null = null;

  constructor(
    private recordingReqService: RecordingAccessRequestService,
    private recordingsService: ClassRecordingsService,
    private authService: AuthService,
    private navService: NavService,
    private snackBar: MatSnackBar,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.refreshApprovalPermissions();
    this.loadRequests();
  }

  private refreshApprovalPermissions(): void {
    const user = this.authService.getSnapshotUser();
    const role = String(user?.role || '').toUpperCase();
    if (role === 'ADMIN' || role === 'TEACHER_ADMIN') {
      this.canBackfill = true;
      this.canManageApprovals = true;
      return;
    }
    if (role === 'TEACHER') {
      this.canBackfill = false;
      this.canManageApprovals = true;
      return;
    }
    if (role === 'SUB_ADMIN') {
      const level = this.navService.getTabAccessLevel(
        'class-recordings',
        user?.sidebarAccessLevels || {},
        user?.sidebarPermissions || []
      );
      this.canManageApprovals = this.navService.canAccessLevel(level || undefined, 'edit');
      this.canBackfill = this.canManageApprovals;
      return;
    }
    this.canBackfill = false;
    this.canManageApprovals = false;
  }

  ngOnDestroy(): void {
    this.stopBackfillPolling();
  }

  setTab(tab: ApprovalTab): void {
    this.activeTab = tab;
    if (tab === 'history') {
      this.loadHistory();
    } else {
      this.loadRequests();
    }
  }

  loadRequests(): void {
    this.loading = true;
    this.error = '';
    this.recordingReqService.getPendingRequests().subscribe({
      next: (res) => {
        this.requests = res.requests || [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load requests.';
        this.loading = false;
      },
    });
  }

  loadHistory(): void {
    this.historyLoading = true;
    this.historyError = '';
    this.recordingReqService
      .getRequestHistory({
        page: this.historyPage,
        limit: this.historyPageSize,
        status: this.historyStatusFilter,
      })
      .subscribe({
        next: (res) => {
          this.historyRequests = res.requests || [];
          this.historyTotal = res.total || 0;
          this.historyCounts = res.counts || null;
          this.historyLoading = false;
        },
        error: (err) => {
          this.historyError = err?.error?.message || 'Failed to load history.';
          this.historyLoading = false;
        },
      });
  }

  onHistoryFilterChange(): void {
    this.historyPage = 1;
    this.loadHistory();
  }

  historyPrevPage(): void {
    if (this.historyPage > 1) {
      this.historyPage -= 1;
      this.loadHistory();
    }
  }

  historyNextPage(): void {
    if (this.historyPage * this.historyPageSize < this.historyTotal) {
      this.historyPage += 1;
      this.loadHistory();
    }
  }

  get historyPageLabel(): string {
    if (!this.historyTotal) return '0 of 0';
    const from = (this.historyPage - 1) * this.historyPageSize + 1;
    const to = Math.min(this.historyPage * this.historyPageSize, this.historyTotal);
    return `${from}–${to} of ${this.historyTotal}`;
  }

  get readyRecordingCount(): number {
    return this.requests.filter((r) => r.hasRecording).length;
  }

  get batchOptions(): string[] {
    const set = new Set<string>();
    for (const r of this.requests) {
      const b = String(r.studentBatch || '').trim();
      if (b) set.add(b);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  /** Pending or Ready tab list, optionally filtered by batch. */
  get displayedPendingRequests(): PendingRequest[] {
    let list =
      this.activeTab === 'ready'
        ? this.requests.filter((r) => r.hasRecording)
        : this.requests;
    const batch = String(this.batchFilter || '').trim();
    if (batch) {
      list = list.filter((r) => String(r.studentBatch || '').trim() === batch);
    }
    return list;
  }

  get displayedReadyCount(): number {
    return this.displayedPendingRequests.length;
  }

  refreshActiveTab(): void {
    if (this.activeTab === 'history') {
      this.loadHistory();
    } else {
      this.loadRequests();
    }
  }

  isRowBusy(req: PendingRequest): boolean {
    return this.busyId === req._id;
  }

  rowStatusText(req: PendingRequest): string {
    return this.rowStatus[req._id] || '';
  }

  approve(req: PendingRequest): void {
    if (!this.canManageApprovals) {
      this.snackBar.open('You do not have permission to approve requests.', 'Close', { duration: 4000 });
      return;
    }
    if (this.busyId || !req.hasRecording) return;
    this.busyId = req._id;
    this.recordingReqService.approveRequest(req._id).subscribe({
      next: () => {
        this.busyId = null;
        this.snackBar.open('Approved — student can play the recording.', 'Close', { duration: 3500 });
        this.loadRequests();
      },
      error: (err) => {
        this.busyId = null;
        this.snackBar.open(err?.error?.message || 'Failed to approve.', 'Close', { duration: 4000 });
      },
    });
  }

  /** Pull recording from Zoom for this class's meeting ID. */
  runBackfill(req: PendingRequest, andApprove: boolean): void {
    if (!this.canBackfill) {
      this.snackBar.open('Only admins can run backfill.', 'Close', { duration: 4000 });
      return;
    }
    const zoomId = this.zoomMeetingIdForBackfill(req);
    if (!zoomId) {
      this.snackBar.open('No Zoom meeting ID on this class.', 'Close', { duration: 4000 });
      return;
    }
    if (this.busyId) return;

    this.busyId = req._id;
    this.rowBackfillMode = andApprove ? 'backfill-approve' : 'backfill';
    this.approveAfterBackfillId = andApprove ? req._id : null;
    this.rowStatus[req._id] = 'Starting backfill…';

    this.recordingsService
      .runZoomBackfill({
        meetingIds: [zoomId],
        limit: 20,
        includeFailed: true,
        force: true,
      })
      .subscribe({
        next: () => {
          this.rowStatus[req._id] = 'Backfilling from Zoom…';
          this.snackBar.open(`Backfill started for meeting ${zoomId}.`, 'Close', { duration: 4000 });
          this.backfillPollRequestId = req._id;
          this.startBackfillPolling();
        },
        error: (err) => {
          this.clearBackfillRowState(req._id);
          this.snackBar.open(err?.error?.message || 'Backfill failed to start.', 'Close', { duration: 5000 });
        },
      });
  }

  private startBackfillPolling(): void {
    this.stopBackfillPolling();
    this.backfillPollTimer = setInterval(() => {
      this.recordingsService.getZoomBackfillStatus().subscribe({
        next: (status: { running?: boolean; error?: string; summary?: Record<string, number> }) => {
          if (status.running) return;
          this.stopBackfillPolling();
          const requestId = this.backfillPollRequestId;
          if (!requestId) return;
          this.onBackfillComplete(requestId, status);
        },
        error: () => {},
      });
    }, 5000);
  }

  private stopBackfillPolling(): void {
    if (this.backfillPollTimer) {
      clearInterval(this.backfillPollTimer);
      this.backfillPollTimer = null;
    }
  }

  private onBackfillComplete(
    requestId: string,
    status: { error?: string; summary?: Record<string, number> }
  ): void {
    const andApprove = this.approveAfterBackfillId === requestId;
    this.approveAfterBackfillId = null;
    this.rowBackfillMode = null;
    this.backfillPollRequestId = null;

    if (status.error) {
      this.clearBackfillRowState(requestId);
      this.snackBar.open(`Backfill error: ${status.error}`, 'Close', { duration: 6000 });
      return;
    }

    const s = status.summary || {};
    const parts: string[] = [];
    if (s['pipelineCompleted']) parts.push(`${s['pipelineCompleted']} processed`);
    if (s['pipelineFailed']) parts.push(`${s['pipelineFailed']} failed`);
    if (s['skippedNoRecordingInZoom']) parts.push(`${s['skippedNoRecordingInZoom']} not in Zoom`);
    const summary = parts.length ? parts.join(', ') : 'complete';

    this.rowStatus[requestId] = 'Checking portal…';

    this.recordingReqService.getPendingRequests().subscribe({
      next: (res) => {
        this.requests = res.requests || [];
        delete this.rowStatus[requestId];
        const updated = this.requests.find((r) => r._id === requestId);

        if (andApprove && updated?.hasRecording) {
          this.snackBar.open(`Backfill done (${summary}). Approving access…`, 'Close', { duration: 4000 });
          this.busyId = null;
          this.approve(updated);
          return;
        }

        this.busyId = null;

        if (andApprove) {
          this.snackBar.open(
            `Backfill finished (${summary}) but recording is still not ready in the portal.`,
            'Close',
            { duration: 7000 }
          );
        } else if (updated?.hasRecording) {
          this.snackBar.open(`Backfill done (${summary}). Recording is now in the portal.`, 'Close', {
            duration: 6000,
          });
        } else {
          this.snackBar.open(`Backfill finished (${summary}). Recording still missing.`, 'Close', {
            duration: 6000,
          });
        }
      },
      error: () => {
        this.clearBackfillRowState(requestId);
        this.snackBar.open('Backfill finished but could not refresh the list.', 'Close', { duration: 5000 });
      },
    });
  }

  private clearBackfillRowState(requestId: string): void {
    this.busyId = null;
    this.approveAfterBackfillId = null;
    this.rowBackfillMode = null;
    this.backfillPollRequestId = null;
    delete this.rowStatus[requestId];
    this.stopBackfillPolling();
  }

  isBackfillMode(req: PendingRequest, mode: 'backfill' | 'backfill-approve'): boolean {
    return this.busyId === req._id && this.rowBackfillMode === mode;
  }

  openDecline(req: PendingRequest): void {
    if (!this.canManageApprovals) {
      this.snackBar.open('You do not have permission to decline requests.', 'Close', { duration: 4000 });
      return;
    }
    if (this.busyId) return;
    this.declineTarget = req;
    this.declineReason = '';
  }

  closeDecline(): void {
    this.declineTarget = null;
    this.declineReason = '';
  }

  confirmDecline(): void {
    if (!this.declineTarget || this.busyId) return;
    this.busyId = this.declineTarget._id;
    this.recordingReqService.declineRequest(this.declineTarget._id, this.declineReason).subscribe({
      next: () => {
        this.busyId = null;
        this.declineTarget = null;
        this.declineReason = '';
        this.snackBar.open('Declined — student has been emailed.', 'Close', { duration: 3500 });
        this.loadRequests();
      },
      error: (err) => {
        this.busyId = null;
        this.snackBar.open(err?.error?.message || 'Failed to decline.', 'Close', { duration: 4000 });
      },
    });
  }

  formatDate(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  statusLabel(status: string): string {
    const s = String(status || '').toUpperCase();
    if (s === 'APPROVED') return 'Approved';
    if (s === 'DECLINED') return 'Declined';
    return s || '—';
  }

  formatReviewedAt(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  reviewerName(req: ReviewedRequest): string {
    return req.reviewedBy?.name || req.reviewedBy?.email || '—';
  }

  formatRequestedAt(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  meetingId(req: PendingRequest): string {
    return req.meetingLinkId?.zoomMeetingId || '—';
  }

  zoomMeetingIdForBackfill(req: PendingRequest): string | null {
    const raw = req.meetingLinkId?.zoomMeetingId;
    const trimmed = String(raw || '').trim();
    return trimmed && trimmed !== '—' ? trimmed : null;
  }

  goToRecordings(): void {
    void this.router.navigate(['/class-recordings']);
  }
}
