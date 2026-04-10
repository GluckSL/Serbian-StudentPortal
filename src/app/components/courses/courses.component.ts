import { Component, OnInit } from '@angular/core';
import { CoursesService } from '../../services/courses.service';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { Course } from '../../services/courses.service';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-courses',
  imports: [FormsModule, CommonModule, HttpClientModule, RouterModule],
  standalone: true,
  templateUrl: './courses.component.html',
  styleUrls: ['./courses.component.css']
})
export class CoursesComponent implements OnInit {
  courses: Course[] = [];
  viewMode: 'grid' | 'list' = 'grid';

  constructor(private coursesService: CoursesService, private notify: NotificationService) {}

  ngOnInit(): void {
    this.loadCourses();
  }

  // Fetch all courses from the backend
  loadCourses(): void {
    this.coursesService.getCourses().subscribe(
      (data: Course[]) => {
        this.courses = data; 
      },
      (error) => {
        console.error('Error fetching courses', error);
      }
    );
  }

  // Delete a course
  deleteCourse(courseId: string): void {
    this.notify.confirm('Delete Course', 'Are you sure you want to delete this course?', 'Yes, Delete', 'Cancel').subscribe(ok => {
      if (!ok) return;
      this.coursesService.deleteCourse(courseId).subscribe({
        next: () => {
          this.courses = this.courses.filter(course => course._id !== courseId);
          this.notify.success('Course deleted successfully.');
        },
        error: () => this.notify.error('Failed to delete the course. Please try again.')
      });
    });
  }
}
