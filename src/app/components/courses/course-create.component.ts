// src/app/components/course-create/course-create.component.ts

import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { CoursesService } from '../../services/courses.service';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { Course } from '../../services/courses.service';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-course-create',
  standalone: true,
  imports: [FormsModule, CommonModule, HttpClientModule],
  templateUrl: './course-create.component.html',
  styleUrls: ['./course-create.component.css']
})
export class CreateCourseComponent implements OnInit, OnDestroy {
  course: Course = { title: '', description: '' };
  isEditMode = false;
  private sub: Subscription | null = null;

  constructor(
    private coursesService: CoursesService,
    private router: Router,
    private route: ActivatedRoute,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    // subscribe to paramMap to react to changes if the component is reused
    this.sub = this.route.paramMap.subscribe((params: ParamMap) => {
      const courseId = params.get('id'); // match the route param name
      console.log('route param id =', courseId);
      if (courseId) {
        this.isEditMode = true;
        this.loadCourse(courseId);
      } else {
        this.isEditMode = false;
        this.course = { title: '', description: '' }; // reset for create mode
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  loadCourse(courseId: string): void {
    this.coursesService.getCourseById(courseId).subscribe({
      next: (data) => {
        //console.log('Loaded course', data);
        // defensive: ensure object has title/description
        this.course = {
          _id: data._id,
          title: data.title ?? '',
          description: data.description ?? ''
        };

        // Resize textarea after setting the value
        setTimeout(() => {
          const textarea = document.querySelector<HTMLTextAreaElement>('textarea[name="description"]');
          if (textarea) {
            this.autoResize({ target: textarea } as any);
          }
        }, 0);
      },
      error: (err) => {
        //console.error('Error loading course:', err);
        this.notify.error('Failed to load course details.');
      }
    });
  }

  createCourse(): void {
    const payload = { title: this.course.title, description: this.course.description };
    this.coursesService.addCourse(payload).subscribe({
      next: () => {
        this.notify.success('Course created successfully!');
        this.router.navigate(['/courses']);
      },
      error: (error) => {
        //console.error('Error creating course', error);
        this.notify.error('Failed to create course. Please try again.');
      }
    });
  }

  updateCourse(): void {
    if (!this.course._id) {
      //console.error('No _id present for update');
      return;
    }

    this.coursesService.updateCourse(this.course._id, {
      title: this.course.title,
      description: this.course.description
    }).subscribe({
      next: () => {
        this.notify.success('Course updated successfully!');
        this.router.navigate(['/courses']);
      },
      error: (error) => {
        //console.error('Error updating course', error);
        this.notify.error('Failed to update course. Please try again.');
      }
    });
  }

  onSubmit(): void {
    if (!this.course.title || !this.course.description) {
      this.notify.warning('Please fill out both title and description.');
      return;
    }
    if (this.isEditMode) {
      this.updateCourse();
    } else {
      this.createCourse();
    }
  }

  autoResize(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }
}
