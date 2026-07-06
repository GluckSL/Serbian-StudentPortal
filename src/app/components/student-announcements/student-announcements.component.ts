import { Component, OnInit, Inject, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../services/auth.service';
import {
  AnnouncementDeliveryType,
  AnnouncementItem,
  AnnouncementComment,
  AnnouncementService
} from '../../services/announcement.service';

@Component({
  selector: 'app-student-announcements',
  standalone: true,
  imports: [CommonModule, MatDialogModule],
  templateUrl: './student-announcements.component.html',
  styleUrls: ['./student-announcements.component.css']
})
export class StudentAnnouncementsComponent implements OnInit {
  loading = false;
  announcements: AnnouncementItem[] = [];
  activeFilter: 'all' | 'website' | 'website_email' = 'all';

  constructor(
    private announcementService: AnnouncementService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.announcementService.getForStudent().subscribe({
      next: (res) => {
        this.announcements = res?.data || [];
        this.loading = false;
      },
      error: () => {
        this.announcements = [];
        this.loading = false;
      }
    });
  }

  get filteredAnnouncements(): AnnouncementItem[] {
    if (this.activeFilter === 'all') return this.announcements;
    return this.announcements.filter((a) => a.deliveryType === this.activeFilter);
  }

  setFilter(filter: 'all' | 'website' | 'website_email'): void {
    this.activeFilter = filter;
  }

  deliveryLabel(dt: AnnouncementDeliveryType): string {
    if (dt === 'website_email') return 'Email + portal';
    if (dt === 'website') return 'Portal';
    return dt;
  }

  openAnnouncement(item: AnnouncementItem): void {
    this.dialog.open(AnnouncementDetailDialogComponent, {
      data: item,
      width: '600px',
      maxWidth: 'calc(100vw - 40px)'
    });
  }
}

const STAFF_ROLES = ['ADMIN', 'TEACHER_ADMIN', 'TEACHER'];

@Component({
  selector: 'app-announcement-detail-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="sa-dialog">
      <button class="sa-dialog__close" mat-icon-button (click)="close()">
        <mat-icon>close</mat-icon>
      </button>

      <div class="sa-dialog__header">
        <span class="sa-dialog__badge" *ngIf="data.deliveryType">{{ getDeliveryLabel(data.deliveryType) }}</span>
        <time class="sa-dialog__date">{{ data.createdAt | date:'medium' }}</time>
      </div>

      <h2 class="sa-dialog__title">{{ data.title }}</h2>

      <div class="sa-dialog__body sa-richtext" [innerHTML]="data.body"></div>

      <div class="sa-dialog__files" *ngIf="data.attachments?.length">
        <div class="sa-dialog__filesTitle">Attachments</div>
        <div class="sa-dialog__fileRow">
          <a
            *ngFor="let file of data.attachments"
            class="sa-dialog__chip"
            [href]="file.fileUrl"
            target="_blank"
            rel="noreferrer"
          >
            <span class="material-icons">attach_file</span>
            {{ file.fileName }}
          </a>
        </div>
      </div>

      <div class="sa-divider"></div>

      <div class="sa-comments">
        <div class="sa-comments__header">
          Comments
          <span class="sa-comments__count" *ngIf="commentTotal > 0">({{ commentTotal }})</span>
        </div>

        <div class="sa-comments__list" *ngIf="comments.length > 0">
          <ng-container *ngFor="let parent of topLevelComments">
            <div class="sa-comment">
              <div class="sa-comment__avatar">{{ getInitial(parent.userId.name) }}</div>
              <div class="sa-comment__body">
                <div class="sa-comment__meta">
                  <span class="sa-comment__name">{{ parent.userId.name }}</span>
                  <span class="sa-comment__role" *ngIf="isStaffRole(parent.userId.role)">{{ parent.userId.role }}</span>
                  <span class="sa-comment__time">{{ parent.createdAt | date:'short' }}</span>
                  <button
                    class="sa-comment__delete"
                    *ngIf="parent.userId._id === currentUserId"
                    (click)="deleteComment(parent)"
                    title="Delete"
                  >
                    <span class="material-icons">delete_outline</span>
                  </button>
                </div>
                <div class="sa-comment__text">{{ parent.text }}</div>
                <div class="sa-replies" *ngIf="getReplies(parent._id).length > 0">
                  <div class="sa-reply" *ngFor="let reply of getReplies(parent._id)">
                    <div class="sa-reply__avatar">{{ getInitial(reply.userId.name) }}</div>
                    <div class="sa-reply__body">
                      <div class="sa-comment__meta">
                        <span class="sa-comment__name">{{ reply.userId.name }}</span>
                        <span class="sa-comment__role" *ngIf="isStaffRole(reply.userId.role)">{{ reply.userId.role }}</span>
                        <span class="sa-comment__time">{{ reply.createdAt | date:'short' }}</span>
                        <button
                          class="sa-comment__delete"
                          *ngIf="reply.userId._id === currentUserId"
                          (click)="deleteComment(reply)"
                          title="Delete"
                        >
                          <span class="material-icons">delete_outline</span>
                        </button>
                      </div>
                      <div class="sa-comment__text">{{ reply.text }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ng-container>
          <div class="sa-comments__more" *ngIf="commentPage < commentTotalPages">
            <button
              class="sa-comments__moreBtn"
              [disabled]="commentsLoadingMore"
              (click)="loadMoreComments()"
            >
              {{ commentsLoadingMore ? 'Loading...' : 'Load more' }}
            </button>
          </div>
        </div>

        <div class="sa-comments__empty" *ngIf="comments.length === 0 && !commentsLoading">
          <span class="material-icons sa-comments__emptyIcon">chat_bubble_outline</span>
          <p>No comments yet</p>
        </div>

        <div class="sa-comments__skeleton" *ngIf="commentsLoading">
          <div class="sa-skel" *ngFor="let i of [1,2]">
            <div class="sa-skel__avatar"></div>
            <div class="sa-skel__lines">
              <div class="sa-skel__line sa-skel__line--short"></div>
              <div class="sa-skel__line"></div>
            </div>
          </div>
        </div>

        <div class="sa-comment-form">
          <textarea
            class="sa-comment-form__input"
            [(ngModel)]="newCommentText"
            placeholder="Write a comment..."
            rows="2"
            maxlength="2000"
          ></textarea>
          <div class="sa-comment-form__bottom">
            <span class="sa-comment-form__count">{{ newCommentText.length }}/2000</span>
            <button
              class="sa-comment-form__submit"
              [disabled]="!newCommentText.trim() || posting"
              (click)="postComment()"
            >
              <span *ngIf="!posting">Post</span>
              <span *ngIf="posting">Posting...</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .sa-dialog {
      position: relative;
      padding: 20px;
      font-family: 'Inter', 'Roboto', system-ui, sans-serif;
      max-height: 80vh;
      overflow-y: auto;
      background: #fff;
    }
    .sa-dialog__close {
      position: absolute;
      top: 12px;
      right: 12px;
    }
    .sa-dialog__close:hover {
      background: transparent;
    }
    .sa-dialog__header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }
    .sa-dialog__badge {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #03396c;
      background: rgba(3, 57, 108, 0.08);
      border-radius: 6px;
      padding: 4px 10px;
    }
    .sa-dialog__date {
      font-size: 12px;
      color: #64748b;
      font-weight: 500;
    }
    .sa-dialog__title {
      margin: 0 0 16px;
      font-size: 1.25rem;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.35;
    }
    .sa-dialog__body {
      margin: 0;
      color: #475569;
      font-size: 14px;
      line-height: 1.6;
    }
    :host ::ng-deep .sa-richtext p { margin: 0 0 10px; }
    :host ::ng-deep .sa-richtext p:last-child { margin-bottom: 0; }
    :host ::ng-deep .sa-richtext ul, :host ::ng-deep .sa-richtext ol { margin: 8px 0 12px 20px; padding: 0; }
    :host ::ng-deep .sa-richtext a { color: #1d4ed8; text-decoration: underline; word-break: break-word; }
    :host ::ng-deep .sa-richtext blockquote {
      margin: 10px 0;
      padding-left: 12px;
      border-left: 3px solid #cbd5e1;
      color: #475569;
    }
    .sa-dialog__files {
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid #f1f5f9;
    }
    .sa-dialog__filesTitle {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #64748b;
      margin-bottom: 10px;
    }
    .sa-dialog__fileRow {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .sa-dialog__chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      color: #03396c;
      font-weight: 600;
      font-size: 12px;
      text-decoration: none;
    }
    .sa-dialog__chip:hover {
      background: #f1f5f9;
      border-color: #cbd5e1;
    }
    .sa-dialog__chip .material-icons {
      font-size: 16px;
      opacity: 0.8;
    }
    .sa-divider {
      margin: 20px 0 16px;
      border-top: 1px solid #f1f5f9;
    }
    .sa-comments__header {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #64748b;
      margin-bottom: 14px;
    }
    .sa-comments__count {
      font-weight: 600;
      color: #94a3b8;
    }
    .sa-comment {
      display: flex;
      gap: 10px;
      margin-bottom: 14px;
    }
    .sa-comment__avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #e2e8f0;
      color: #475569;
      font-size: 12px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      text-transform: uppercase;
    }
    .sa-comment__body {
      flex: 1;
      min-width: 0;
    }
    .sa-comment__meta {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 2px;
    }
    .sa-comment__name {
      font-size: 13px;
      font-weight: 600;
      color: #0f172a;
    }
    .sa-comment__role {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: #dbeafe;
      color: #1d4ed8;
      padding: 1px 6px;
      border-radius: 4px;
    }
    .sa-comment__time {
      font-size: 11px;
      color: #94a3b8;
      margin-left: auto;
    }
    .sa-comment__delete {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      background: transparent;
      border: 1px solid transparent;
      cursor: pointer;
      color: #94a3b8;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      transition: all 0.15s;
      flex-shrink: 0;
    }
    .sa-comment__delete:hover {
      background: #fef2f2;
      border-color: #fca5a5;
      color: #dc2626;
    }
    .sa-comment__delete .material-icons {
      font-size: 18px;
    }
    .sa-replies {
      margin: 8px 0 0 20px;
      padding-left: 12px;
      border-left: 2px solid #e2e8f0;
    }
    .sa-reply {
      display: flex;
      gap: 8px;
      margin-bottom: 10px;
    }
    .sa-reply:last-child {
      margin-bottom: 0;
    }
    .sa-reply__avatar {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: #e2e8f0;
      color: #475569;
      font-size: 11px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      text-transform: uppercase;
    }
    .sa-reply__body {
      flex: 1;
      min-width: 0;
    }
    .sa-comment__text {
      font-size: 14px;
      color: #334155;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .sa-comments__empty {
      text-align: center;
      padding: 20px 0;
      color: #94a3b8;
    }
    .sa-comments__emptyIcon {
      font-size: 28px;
      margin-bottom: 4px;
    }
    .sa-comments__empty p {
      margin: 0;
      font-size: 13px;
    }
    .sa-comments__skeleton {
      margin-bottom: 12px;
    }
    .sa-skel {
      display: flex;
      gap: 10px;
      margin-bottom: 14px;
    }
    .sa-skel__avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #f1f5f9;
      flex-shrink: 0;
    }
    .sa-skel__lines {
      flex: 1;
    }
    .sa-skel__line {
      height: 12px;
      background: #f1f5f9;
      border-radius: 4px;
      margin-bottom: 6px;
    }
    .sa-skel__line--short {
      width: 80px;
    }
    .sa-comments__more {
      text-align: center;
      padding: 8px 0 4px;
    }
    .sa-comments__moreBtn {
      padding: 6px 18px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      background: #fff;
      color: #475569;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .sa-comments__moreBtn:hover:not(:disabled) {
      background: #f8fafc;
      border-color: #cbd5e1;
      color: #0f172a;
    }
    .sa-comments__moreBtn:disabled {
      opacity: 0.6;
      cursor: default;
    }
    .sa-comment-form {
      margin-top: 12px;
    }
    .sa-comment-form__input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-family: inherit;
      font-size: 13px;
      resize: vertical;
      outline: none;
      transition: border-color 0.15s;
    }
    .sa-comment-form__input:focus {
      border-color: #03396c;
    }
    .sa-comment-form__bottom {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 6px;
    }
    .sa-comment-form__count {
      font-size: 11px;
      color: #94a3b8;
    }
    .sa-comment-form__submit {
      padding: 6px 18px;
      border-radius: 8px;
      border: none;
      background: #03396c;
      color: #fff;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .sa-comment-form__submit:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .sa-comment-form__submit:not(:disabled):hover {
      opacity: 0.9;
    }
  `]
})
export class AnnouncementDetailDialogComponent implements OnInit, OnDestroy {
  comments: AnnouncementComment[] = [];
  commentsLoading = false;
  commentsLoadingMore = false;
  commentPage = 1;
  commentTotalPages = 0;
  commentTotal = 0;
  newCommentText = '';
  posting = false;
  currentUserId: string | null = null;

  get topLevelComments(): AnnouncementComment[] {
    return this.comments
      .filter((c) => !c.parentCommentId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getReplies(commentId: string): AnnouncementComment[] {
    return this.comments
      .filter((c) => c.parentCommentId === commentId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: AnnouncementItem,
    private dialogRef: MatDialogRef<AnnouncementDetailDialogComponent>,
    private announcementService: AnnouncementService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    const user = this.authService.getSnapshotUser();
    this.currentUserId = user?._id || null;
    this.loadComments(1, true);
  }

  ngOnDestroy(): void {}

  close(): void {
    this.dialogRef.close();
  }

  getDeliveryLabel(dt: AnnouncementDeliveryType): string {
    if (dt === 'website_email') return 'Email + portal';
    if (dt === 'website') return 'Portal';
    return dt;
  }

  isStaffRole(role: string | undefined): boolean {
    return STAFF_ROLES.includes(String(role || '').toUpperCase());
  }

  getInitial(name: string | undefined): string {
    return (name || '?').charAt(0).toUpperCase();
  }

  loadComments(page: number = 1, replace: boolean = true): void {
    if (replace) {
      this.commentsLoading = true;
    } else {
      this.commentsLoadingMore = true;
    }

    this.announcementService.getComments(this.data._id, page).subscribe({
      next: (res) => {
        const items = res?.data || [];
        const pag = res?.pagination;
        if (pag) {
          this.commentPage = pag.page;
          this.commentTotalPages = pag.totalPages;
          this.commentTotal = pag.total;
        }
        this.comments = replace ? items : [...this.comments, ...items];
        this.commentsLoading = false;
        this.commentsLoadingMore = false;
      },
      error: () => {
        this.comments = replace ? [] : this.comments;
        this.commentsLoading = false;
        this.commentsLoadingMore = false;
      }
    });
  }

  loadMoreComments(): void {
    if (this.commentPage >= this.commentTotalPages || this.commentsLoadingMore) return;
    this.loadComments(this.commentPage + 1, false);
  }

  postComment(): void {
    const text = this.newCommentText.trim();
    if (!text || this.posting) return;

    this.posting = true;
    this.announcementService.createComment(this.data._id, text).subscribe({
      next: () => {
        this.newCommentText = '';
        this.posting = false;
        this.loadComments(1, true);
      },
      error: () => {
        this.posting = false;
      }
    });
  }

  deleteComment(comment: AnnouncementComment): void {
    if (!confirm('Delete this comment?')) return;
    this.announcementService.deleteComment(this.data._id, comment._id).subscribe({
      next: () => this.loadComments(1, true),
      error: () => {}
    });
  }
}
