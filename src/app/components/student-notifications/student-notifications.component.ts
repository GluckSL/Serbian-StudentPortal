// src/app/components/student-notifications/student-notifications.component.ts
import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Observable } from 'rxjs';
import { NgFor } from '@angular/common';
import { NgIf } from '@angular/common';

interface Notification {
  _id: string;
  type: string;
  message: string;
  read: boolean;
  createdAt: string;
  assignmentId?: { _id: string; title: string; status: string };
  actorId?: { _id: string; name: string; regNo: string };
}

@Component({
  selector: 'app-student-notifications',
  templateUrl: './student-notifications.component.html',
  styleUrls: ['./student-notifications.component.css'],
  imports: [NgIf, NgFor, DatePipe],
})
export class StudentNotificationsComponent implements OnInit {
  notifications: Notification[] = [];
  loading = false;
  error = '';

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadNotifications();
  }

  loadNotifications() {
    this.loading = true;
    this.error = '';

    this.http
      .get<any>('/api/notifications', {
        params: { type: 'ASSIGNMENT_ASSIGNED' },
        withCredentials: true,
      })
      .subscribe({
        next: (res) => {
          this.loading = false;
          this.notifications = res.data || [];
        },
        error: () => {
          this.loading = false;
          this.error = 'Failed to load notifications.';
        },
      });
  }

  markAsRead(notification: Notification) {
    if (notification.read) return;

    this.http
      .patch<any>(`/api/notifications/${notification._id}/read`, {}, {
        withCredentials: true,
      })
      .subscribe({
        next: () => {
          notification.read = true;
        },
        error: () => {},
      });
  }

  markAllAsRead() {
    this.http
      .patch<any>('/api/notifications/mark-all/read', {}, {
        withCredentials: true,
      })
      .subscribe({
        next: () => {
          this.notifications.forEach((n) => (n.read = true));
        },
        error: () => {},
      });
  }
}
