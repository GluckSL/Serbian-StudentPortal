//src/app/components/admin-dashboard/admin-dashboard.component.ts

import { Component, OnInit, TrackByFunction } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { Router, RouterModule } from '@angular/router';
import { HttpClient, HttpClientModule} from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FeedbackService } from '../../services/feedback.service';
import { NgChartsModule } from 'ng2-charts';
import { MaterialModule } from '../../shared/material.module';
import { MatDialog } from '@angular/material/dialog';
import { environment } from '../../../environments/environment';

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
}


@Component({
  selector: '',
  standalone: true,
  imports: [
    HttpClientModule,
    CommonModule,
    FormsModule,
    MaterialModule,
    NgChartsModule,
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

  selectedTeacherName?: string;

  constructor(
    private authService: AuthService,
    private router: Router,
    private http: HttpClient,
    private dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    // ✅ Check user profile from backend (cookie included automatically)
    this.authService.getUserProfile().subscribe({
      next: (user) => {
        if (user.role !== 'ADMIN' && user.role !== 'TEACHER_ADMIN') {
          this.router.navigate(['/dashboard']);
          return;
        }
        this.fetchTeachers();
      },
      error: (err) => {
        console.error('Not authenticated:', err);
        this.router.navigate(['/auth/login']);
      }
    });
  }

fetchTeachers(): void {
  this.loading = true;

  this.http.get<{ success: boolean; data: Teacher[] }>(`${apiUrl}/admin/teachers`, { withCredentials: true }).subscribe({
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
    if (confirm('Are you sure you want to delete this user?')) {
      this.authService.deleteUser(id).subscribe({
        next: (response) => {
          alert('User deleted successfully!');
          //console.log('Deleted:', response);
          this.fetchTeachers(); // Refresh your user list after deletion
        },
        error: (error) => {
          alert('Failed to delete user: ' + (error.error?.message || 'Please try again.'));
          //console.error('Delete failed:', error);
        }
      });
    }
  }


  trackById(index: number, teacher: Teacher): string {
    return teacher._id;
  }

}
