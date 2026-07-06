import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  AnnouncementItem,
  AnnouncementComment,
  AnnouncementService
} from '../../services/announcement.service';
const STAFF_ROLES = ['ADMIN', 'TEACHER_ADMIN', 'TEACHER'];

@Component({
  selector: 'app-admin-announcement-comments',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule],
  template: `
    <div class="ac-modal" (click)="$event.stopPropagation()">
      <button class="ac-modal__close" (click)="close()">
        <span class="material-icons">close</span>
      </button>

      <div class="ac-modal__header">
        <span class="ac-modal__badge">Comments</span>
      </div>
      <h2 class="ac-modal__title">{{ announcement.title }}</h2>

      <div class="ac-list" *ngIf="!loading">
        <div class="ac-empty" *ngIf="comments.length === 0">
          <span class="material-icons">chat_bubble_outline</span>
          <p>No comments yet</p>
        </div>

        <ng-container *ngFor="let parent of topLevelComments">
          <div class="ac-comment">
            <div class="ac-comment__avatar">{{ getInitial(parent.userId.name) }}</div>
            <div class="ac-comment__body">
              <div class="ac-comment__meta">
                <span class="ac-comment__name">{{ parent.userId.name }}</span>
                <span class="ac-comment__role" *ngIf="STAFF_ROLES.includes(parent.userId.role)">{{ parent.userId.role }}</span>
                <span class="ac-comment__time">{{ parent.createdAt | date:'short' }}</span>
                <button class="ac-comment__delete" (click)="deleteComment(parent)" title="Delete">
                  <span class="material-icons">delete_outline</span>
                </button>
              </div>
              <div class="ac-comment__text">{{ parent.text }}</div>
              <button class="ac-comment__replyBtn" (click)="startReply(parent)">Reply</button>
              <div class="ac-reply-form" *ngIf="replyTargetId === parent._id">
                <textarea class="ac-reply-form__input" [(ngModel)]="replyText" placeholder="Write a reply..." rows="2" maxlength="2000"></textarea>
                <div class="ac-reply-form__actions">
                  <button class="ac-reply-form__cancel" (click)="cancelReply()">Cancel</button>
                  <button class="ac-reply-form__submit" [disabled]="!replyText.trim() || posting" (click)="postReply(parent)">
                    {{ posting ? 'Sending...' : 'Reply' }}
                  </button>
                </div>
              </div>
              <div class="ac-replies" *ngIf="getReplies(parent._id).length > 0">
                <div class="ac-reply" *ngFor="let reply of getReplies(parent._id)">
                  <div class="ac-reply__avatar">{{ getInitial(reply.userId.name) }}</div>
                  <div class="ac-reply__body">
                    <div class="ac-comment__meta">
                      <span class="ac-comment__name">{{ reply.userId.name }}</span>
                      <span class="ac-comment__role" *ngIf="STAFF_ROLES.includes(reply.userId.role)">{{ reply.userId.role }}</span>
                      <span class="ac-comment__time">{{ reply.createdAt | date:'short' }}</span>
                      <button class="ac-comment__delete" (click)="deleteComment(reply)" title="Delete">
                        <span class="material-icons">delete_outline</span>
                      </button>
                    </div>
                    <div class="ac-comment__text">{{ reply.text }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </ng-container>
      </div>

      <div class="ac-skeleton" *ngIf="loading">
        <div class="ac-skel" *ngFor="let i of [1,2,3]">
          <div class="ac-skel__avatar"></div>
          <div class="ac-skel__lines">
            <div class="ac-skel__line ac-skel__line--short"></div>
            <div class="ac-skel__line"></div>
            <div class="ac-skel__line ac-skel__line--med"></div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .ac-modal {
      position: relative;
      background: #fff;
      padding: 20px;
      font-family: 'Inter', 'Roboto', system-ui, sans-serif;
      max-height: 80vh;
      overflow-y: auto;
      width: 600px;
      max-width: calc(100vw - 40px);
    }
    .ac-modal__close {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 32px;
      height: 32px;
      background: none;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #64748b;
    }
    .ac-modal__close:hover {
      background: transparent;
    }
    .ac-modal__header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }
    .ac-modal__badge {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #03396c;
      background: rgba(3, 57, 108, 0.08);
      border-radius: 6px;
      padding: 4px 10px;
    }
    .ac-modal__title {
      margin: 0 0 16px;
      font-size: 1.25rem;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.35;
    }
    .ac-empty {
      text-align: center;
      padding: 40px 0;
      color: #94a3b8;
    }
    .ac-empty span { font-size: 36px; margin-bottom: 8px; }
    .ac-empty p { margin: 0; font-size: 14px; }
    .ac-comment {
      display: flex;
      gap: 10px;
      margin-bottom: 18px;
    }
    .ac-comment__avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: #e2e8f0;
      color: #475569;
      font-size: 13px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      text-transform: uppercase;
    }
    .ac-comment__body { flex: 1; min-width: 0; }
    .ac-comment__meta {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 2px;
    }
    .ac-comment__name { font-size: 13px; font-weight: 600; color: #0f172a; }
    .ac-comment__role {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: #dbeafe;
      color: #1d4ed8;
      padding: 1px 6px;
      border-radius: 4px;
    }
    .ac-comment__time { font-size: 11px; color: #94a3b8; margin-left: auto; }
    .ac-comment__delete {
      width: 32px; height: 32px;
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
    .ac-comment__delete:hover {
      background: #fef2f2;
      border-color: #fca5a5;
      color: #dc2626;
    }
    .ac-comment__delete .material-icons { font-size: 18px; }
    .ac-replies {
      margin: 10px 0 0 20px;
      padding-left: 12px;
      border-left: 2px solid #e2e8f0;
    }
    .ac-reply {
      display: flex;
      gap: 8px;
      margin-bottom: 10px;
    }
    .ac-reply:last-child { margin-bottom: 0; }
    .ac-reply__avatar {
      width: 26px; height: 26px;
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
    .ac-reply__body { flex: 1; min-width: 0; }
    .ac-comment__text {
      font-size: 14px;
      color: #334155;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .ac-comment__replyBtn {
      margin-top: 4px;
      padding: 0;
      background: none;
      border: none;
      color: #03396c;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .ac-comment__replyBtn:hover { text-decoration: underline; }
    .ac-reply-form {
      margin-top: 8px;
      padding: 10px;
      background: #f8fafc;
      border-radius: 8px;
    }
    .ac-reply-form__input {
      width: 100%;
      box-sizing: border-box;
      padding: 8px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-family: inherit;
      font-size: 13px;
      resize: vertical;
      outline: none;
    }
    .ac-reply-form__input:focus { border-color: #03396c; }
    .ac-reply-form__actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 6px;
    }
    .ac-reply-form__cancel {
      padding: 4px 12px;
      background: none;
      border: none;
      color: #64748b;
      font-size: 12px;
      cursor: pointer;
    }
    .ac-reply-form__submit {
      padding: 4px 14px;
      border-radius: 6px;
      border: none;
      background: #03396c;
      color: #fff;
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
    }
    .ac-reply-form__submit:disabled { opacity: 0.5; cursor: default; }
    .ac-skeleton { padding: 10px 0; }
    .ac-skel { display: flex; gap: 10px; margin-bottom: 18px; }
    .ac-skel__avatar { width: 34px; height: 34px; border-radius: 50%; background: #f1f5f9; flex-shrink: 0; }
    .ac-skel__lines { flex: 1; }
    .ac-skel__line { height: 12px; background: #f1f5f9; border-radius: 4px; margin-bottom: 6px; }
    .ac-skel__line--short { width: 80px; }
    .ac-skel__line--med { width: 160px; }
  `]
})
export class AdminAnnouncementCommentsComponent implements OnInit, OnDestroy {
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  readonly STAFF_ROLES = STAFF_ROLES;
  comments: AnnouncementComment[] = [];
  loading = false;
  posting = false;
  replyTargetId: string | null = null;
  replyText = '';

  @Input() announcement!: AnnouncementItem;
  @Output() closePanel = new EventEmitter<void>();

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
    private announcementService: AnnouncementService
  ) {}

  ngOnInit(): void {
    this.loadComments();
    this.pollInterval = setInterval(() => this.loadComments(), 30_000);
  }

  ngOnDestroy(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  close(): void {
    this.closePanel.emit();
  }

  getInitial(name: string | undefined): string {
    return (name || '?').charAt(0).toUpperCase();
  }

  loadComments(): void {
    this.loading = true;
    this.announcementService.getComments(this.announcement._id, 1, 50).subscribe({
      next: (res) => {
        this.comments = res?.data || [];
        this.loading = false;
      },
      error: () => {
        this.comments = [];
        this.loading = false;
      }
    });
  }

  startReply(comment: AnnouncementComment): void {
    this.replyTargetId = comment._id;
    this.replyText = '';
  }

  cancelReply(): void {
    this.replyTargetId = null;
    this.replyText = '';
  }

  postReply(parent: AnnouncementComment): void {
    const text = this.replyText.trim();
    if (!text || this.posting) return;

    this.posting = true;
    this.announcementService.createComment(this.announcement._id, text, parent._id).subscribe({
      next: () => {
        this.replyText = '';
        this.replyTargetId = null;
        this.posting = false;
        this.loadComments();
      },
      error: () => {
        this.posting = false;
      }
    });
  }

  deleteComment(comment: AnnouncementComment): void {
    if (!confirm('Delete this comment?')) return;
    this.announcementService.deleteComment(this.announcement._id, comment._id).subscribe({
      next: () => this.loadComments(),
      error: () => {}
    });
  }
}
