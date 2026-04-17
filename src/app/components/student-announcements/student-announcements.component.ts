import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AnnouncementItem, AnnouncementService } from '../../services/announcement.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-student-announcements',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './student-announcements.component.html',
  styleUrls: ['./student-announcements.component.css']
})
export class StudentAnnouncementsComponent implements OnInit {
  loading = false;
  announcements: AnnouncementItem[] = [];
  activeFilter: 'all' | 'website' | 'website_email' = 'all';

  constructor(
    private announcementService: AnnouncementService,
    private authService: AuthService
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

  get studentName(): string {
    const n = this.authService.getSnapshotUser()?.name || '';
    if (!n) return 'Student';
    return n.split(/\s+/)[0];
  }

  get announcementCount(): number {
    return this.announcements.length;
  }

  get filteredAnnouncements(): AnnouncementItem[] {
    if (this.activeFilter === 'all') return this.announcements;
    return this.announcements.filter((a) => a.deliveryType === this.activeFilter);
  }

  setFilter(filter: 'all' | 'website' | 'website_email'): void {
    this.activeFilter = filter;
  }
}
