//src/app/components/admin-dashboard/admin-dashboard.component.ts

import { Component, OnInit } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { Router, RouterModule } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from '../../shared/material.module';
import { environment } from '../../../environments/environment';
import { NotificationService } from '../../services/notification.service';
import { getAuthToken } from '../../services/auth.service';

const apiUrl = environment.apiUrl;  // Base API URL

interface Course {
  _id: string;
  title: string;
}

interface Teacher {
  _id: string;
  name: string;
  regNo: string;
  email: string;
  role: string;
  assignedCourses: Course[];
  assignedBatches: string[];
  medium: string;
  studentCount?: number;
  phoneNumber?: string;
  whatsappNumber?: string;
}

interface PasswordModalState {
  open: boolean;
  user: Teacher | null;
  newPassword: string;
  confirmPassword: string;
  showPass: boolean;
  saving: boolean;
  generatedPreview: string;
  error: string;
}

@Component({
  selector: '',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MaterialModule,
    RouterModule
  ],
  templateUrl: './teachers.component.html',
  styleUrls: ['./teachers.component.css']
})

export class TeachersComponent implements OnInit {
  teachers: any[] = [];          // original data
  filteredTeachers: any[] = [];  // shown in table
  selectedTeacherIds = new Set<string>();

  loading = false;
  error = '';
  filters = { medium: '', course: '' };
  medium: string[] = ['Sinhala', 'Tamil'];
  course: string[] = ['A1', 'A2', 'B1', 'B2'];

  pwModal: PasswordModalState = {
    open: false,
    user: null,
    newPassword: '',
    confirmPassword: '',
    showPass: false,
    saving: false,
    generatedPreview: '',
    error: '',
  };

  /** teacherId → true while share-timetable request is in flight */
  sharingTimetableIds = new Set<string>();

  constructor(
    private authService: AuthService,
    private router: Router,
    private http: HttpClient,
    private notify: NotificationService,
  ) {}

  ngOnInit(): void {
    this.fetchTeachers();
  }

  private authHeaders(): HttpHeaders | undefined {
    const token = getAuthToken();
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;
  }

  fetchTeachers(): void {
  this.loading = true;
  this.error = '';

  this.http.get<{ success: boolean; data: Teacher[] }>(`${apiUrl}/admin/teachers`, {
    withCredentials: true,
    headers: this.authHeaders(),
  }).subscribe({
    next: res => {
      if (res.success) {
        this.teachers = res.data;
        this.teachers.forEach(teacher => {
          //console.log('Teacher data:', teacher);
        });
        this.filteredTeachers = [...this.teachers];
      } else {
        this.error = 'Failed to load teachers';
      }
      this.loading = false;
    },
    error: err => {
      console.error('Error fetching teachers:', err);
      this.error = err.error?.msg || 'Failed to load teachers';
      if (err.status === 401 || err.status === 403) {
        this.router.navigate(['/login']);
      }
      this.loading = false;
    }
  });
  }

  applyFilters(): void {
    this.filteredTeachers = this.teachers.filter((teacher: Teacher) => {
      const mediumMatch =
        !this.filters.medium || teacher.medium === this.filters.medium;

      const courseMatch =
        !this.filters.course ||
        (teacher.assignedCourses &&
          teacher.assignedCourses.some((c: Course) => c.title === this.filters.course));

      return mediumMatch && courseMatch;
    });
  }

  clearFilters(): void {
    this.filters = { medium: '', course: '' };
    this.filteredTeachers = [...this.teachers];
  }

  deleteUser(id: string): void {
    this.notify.confirm('Delete User', 'Are you sure you want to delete this user?', 'Yes, Delete', 'Cancel').subscribe(ok => {
      if (!ok) return;
      this.authService.deleteUser(id).subscribe({
        next: () => {
          this.notify.success('User deleted successfully!');
          this.fetchTeachers();
        },
        error: (error) => {
          this.notify.error('Failed to delete user: ' + (error.error?.message || 'Please try again.'));
        }
      });
    });
  }

  openTeacherAnalytics(teacher: Teacher): void {
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/teachers', teacher._id, 'analytics'])
    );
    window.open(url, '_blank');
  }

  openAnalyticsOverview(): void {
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/teachers/analytics-overview'])
    );
    window.open(url, '_blank');
  }

  openPasswordModal(teacher: Teacher): void {
    this.pwModal = {
      open: true,
      user: teacher,
      newPassword: '',
      confirmPassword: '',
      showPass: false,
      saving: false,
      generatedPreview: '',
      error: '',
    };
  }

  closePasswordModal(): void {
    this.pwModal.open = false;
  }

  generateRandomPassword(): void {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let pwd = '';
    for (let i = 0; i < 12; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.pwModal.generatedPreview = pwd;
    this.pwModal.newPassword = pwd;
    this.pwModal.confirmPassword = pwd;
    this.pwModal.error = '';
  }

  copyPassword(): void {
    if (this.pwModal.generatedPreview) {
      navigator.clipboard.writeText(this.pwModal.generatedPreview).then(() => {
        this.notify.success('Password copied to clipboard!');
      });
    }
  }

  savePassword(andEmail: boolean): void {
    const { newPassword, confirmPassword, user } = this.pwModal;

    if (!newPassword || newPassword.trim().length < 6) {
      this.pwModal.error = 'Password must be at least 6 characters.';
      return;
    }
    if (newPassword !== confirmPassword) {
      this.pwModal.error = 'Passwords do not match.';
      return;
    }
    if (!user) return;

    this.pwModal.error = '';
    this.pwModal.saving = true;

    const endpoint = andEmail ? 'admin-set-password-and-email' : 'admin-set-password';
    const headers = this.authHeaders();
    if (!headers) {
      this.pwModal.saving = false;
      this.pwModal.error = 'Your session has expired. Please log in again.';
      return;
    }

    this.http.put(
      `${apiUrl}/auth/${endpoint}/${user._id}`,
      { newPassword: newPassword.trim() },
      { withCredentials: true, headers },
    ).subscribe({
      next: () => {
        this.pwModal.saving = false;
        if (andEmail) {
          this.notify.success(`Password updated and emailed to ${user.email}.`);
        } else {
          this.notify.success(`Password updated successfully for ${user.name}.`);
        }
        this.closePasswordModal();
      },
      error: (err) => {
        this.pwModal.saving = false;
        this.pwModal.error = err?.error?.message || 'Failed to update password. Please try again.';
      },
    });
  }

  trackById(index: number, teacher: Teacher): string {
    return teacher._id;
  }

  isSharingTimetable(teacherId: string): boolean {
    return this.sharingTimetableIds.has(teacherId);
  }

  shareTimetable(teacher: Teacher): void {
    if (this.isSharingTimetable(teacher._id)) return;

    const phone = (teacher.whatsappNumber || teacher.phoneNumber || '').trim();
    const phoneNote = phone
      ? ''
      : '\n\n⚠️ This teacher has no WhatsApp number saved. WhatsApp will NOT be sent until you edit their profile and add one.';

    this.notify
      .confirm(
        'Share Weekly Timetable',
        `Send this week's live class schedule (Monday–Sunday) to ${teacher.name} via email and WhatsApp?${phoneNote}`,
        'Yes, Share',
        'Cancel'
      )
      .subscribe((ok) => {
        if (!ok) return;

        this.sharingTimetableIds.add(teacher._id);
        this.http
          .post<{ success: boolean; message?: string; data?: any; warnings?: string[] }>(
            `${apiUrl}/admin/teachers/${teacher._id}/share-timetable`,
            {},
            { withCredentials: true, headers: this.authHeaders() }
          )
          .subscribe({
            next: (res) => {
              this.sharingTimetableIds.delete(teacher._id);
              const d = res.data || {};
              const warnings = res.warnings?.length ? res.warnings : d.warnings || [];

              if (warnings.length) {
                this.notify.error(warnings.join(' '));
              }

              if (!res.success && !d.emailSent && !d.whatsappSent) {
                if (!warnings.length) {
                  this.notify.error(res.message || 'Failed to share timetable.');
                }
                return;
              }

              const parts: string[] = [];
              if (d.emailSent) parts.push('email');
              if (d.whatsappSent) parts.push('WhatsApp');
              const channels = parts.length ? parts.join(' & ') : 'no channel';
              const count = d.meetingCount ?? 0;
              const week = d.weekLabel ? ` (${d.weekLabel})` : '';

              if (count === 0) {
                this.notify.info(`No live classes this week${week}.`);
              } else if (parts.length) {
                this.notify.success(
                  `Timetable shared with ${teacher.name}${week}: ${count} class(es) via ${channels}.`
                );
              }
            },
            error: (err) => {
              this.sharingTimetableIds.delete(teacher._id);
              this.notify.error(err.error?.message || 'Failed to share timetable. Please try again.');
            },
          });
      });
  }

}
