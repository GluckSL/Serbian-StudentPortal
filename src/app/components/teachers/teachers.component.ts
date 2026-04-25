//src/app/components/admin-dashboard/admin-dashboard.component.ts

import { Component, OnInit } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { Router, RouterModule } from '@angular/router';
import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
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
}

@Component({
  selector: '',
  standalone: true,
  imports: [
    HttpClientModule,
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

  constructor(
    private authService: AuthService,
    private router: Router,
    private http: HttpClient,
    private notify: NotificationService,
  ) {}

  ngOnInit(): void {
    this.fetchTeachers();
  }

fetchTeachers(): void {
  this.loading = true;
  this.error = '';

  const token = getAuthToken();
  const headers = token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;

  this.http.get<{ success: boolean; data: Teacher[] }>(`${apiUrl}/admin/teachers`, { withCredentials: true, headers }).subscribe({
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


  trackById(index: number, teacher: Teacher): string {
    return teacher._id;
  }

}
