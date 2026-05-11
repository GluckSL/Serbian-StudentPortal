import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AnnouncementDeliveryType,
  AnnouncementItem,
  AnnouncementService
} from '../../services/announcement.service';

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

  constructor(private announcementService: AnnouncementService) {}

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
}
