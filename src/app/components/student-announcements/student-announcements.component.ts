import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog, MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  AnnouncementDeliveryType,
  AnnouncementItem,
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

@Component({
  selector: 'app-announcement-detail-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
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
    </div>
  `,
  styles: [`
    .sa-dialog {
      position: relative;
      padding: 20px;
      font-family: 'Inter', 'Roboto', system-ui, sans-serif;
      max-height: 70vh;
      overflow-y: auto;
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
    .sa-richtext p { margin: 0 0 10px; }
    .sa-richtext p:last-child { margin-bottom: 0; }
    .sa-richtext ul, .sa-richtext ol { margin: 8px 0 12px 20px; padding: 0; }
    .sa-richtext a { color: #1d4ed8; text-decoration: underline; word-break: break-word; }
    .sa-richtext blockquote {
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
  `]
})
export class AnnouncementDetailDialogComponent {
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: AnnouncementItem,
    private dialogRef: MatDialogRef<AnnouncementDetailDialogComponent>
  ) {}

  close(): void {
    this.dialogRef.close();
  }

  getDeliveryLabel(dt: AnnouncementDeliveryType): string {
    if (dt === 'website_email') return 'Email + portal';
    if (dt === 'website') return 'Portal';
    return dt;
  }
}
