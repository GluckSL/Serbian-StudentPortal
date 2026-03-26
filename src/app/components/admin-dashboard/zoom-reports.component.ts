// src/app/components/admin-dashboard/zoom-reports.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from '../../shared/material.module';
import { ZoomService } from '../../services/zoom.service';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';

interface MeetingReport {
  _id: string;
  topic: string;
  batch: string;
  startTime: Date;
  duration: number;
  teacher: { name: string; email: string; };
  attendees: number;
  attended: number;
  absent: number;
  attendanceRate: number;
  status: string;
}

@Component({
  selector: 'app-zoom-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  templateUrl: './zoom-reports.component.html',
  styleUrls: ['./zoom-reports.component.css']
})
export class ZoomReportsComponent implements OnInit {
  allMeetings: any[] = [];
  completedMeetings: MeetingReport[] = [];
  filteredMeetings: MeetingReport[] = [];

  loading = false;
  error = '';

  teacherFilter = 'all';
  batchFilter = 'all';
  dateFilter = 'all';
  customDateFrom = '';
  customDateTo = '';
  searchQuery = '';

  stats = { totalMeetings: 0, totalStudents: 0, avgAttendance: 0, totalDuration: 0 };

  isTeacherRole = false;

  constructor(
    private zoomService: ZoomService,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      if (user) {
        this.isTeacherRole = user.role === 'TEACHER';
        this.loadCompletedMeetings();
      }
    });
  }

  loadCompletedMeetings(): void {
    this.loading = true;
    this.error = '';
    this.zoomService.getAllMeetings().subscribe({
      next: (response) => {
        if (response.success) {
          this.allMeetings = response.data;
          this.processCompletedMeetings();
          this.applyFilters();
        } else {
          this.error = response.message || 'Failed to load meetings';
        }
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load meeting reports';
        this.loading = false;
      }
    });
  }

  processCompletedMeetings(): void {
    const now = new Date();
    this.completedMeetings = this.allMeetings
      .filter(m => new Date(new Date(m.startTime).getTime() + m.duration * 60000) < now)
      .map(m => {
        const attended = m.attendance?.filter((a: any) => a.attended).length || 0;
        const total = m.attendees?.length || 0;
        return {
          _id: m._id,
          topic: m.topic,
          batch: m.batch,
          startTime: new Date(m.startTime),
          duration: m.duration,
          teacher: { name: m.createdBy?.name || 'Unknown', email: m.createdBy?.email || '' },
          attendees: total,
          attended,
          absent: total - attended,
          attendanceRate: total > 0 ? Math.round((attended / total) * 100) : 0,
          status: 'completed'
        };
      })
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  }

  applyFilters(): void {
    this.filteredMeetings = this.completedMeetings.filter(m => {
      if (this.teacherFilter !== 'all' && m.teacher.name !== this.teacherFilter) return false;
      if (this.batchFilter !== 'all' && m.batch !== this.batchFilter) return false;

      if (this.dateFilter !== 'all') {
        const now = new Date();
        if (this.dateFilter === 'today' && m.startTime.toDateString() !== now.toDateString()) return false;
        if (this.dateFilter === 'week' && m.startTime < new Date(now.getTime() - 7 * 864e5)) return false;
        if (this.dateFilter === 'month' && m.startTime < new Date(now.getTime() - 30 * 864e5)) return false;
        if (this.dateFilter === 'custom') {
          if (this.customDateFrom) {
            const from = new Date(this.customDateFrom); from.setHours(0, 0, 0, 0);
            if (m.startTime < from) return false;
          }
          if (this.customDateTo) {
            const to = new Date(this.customDateTo); to.setHours(23, 59, 59, 999);
            if (m.startTime > to) return false;
          }
        }
      }

      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        return m.topic.toLowerCase().includes(q) ||
               m.teacher.name.toLowerCase().includes(q) ||
               m.batch.toLowerCase().includes(q);
      }

      return true;
    });

    this.recalculateStats();
  }

  recalculateStats(): void {
    if (!this.filteredMeetings.length) {
      this.stats = { totalMeetings: 0, totalStudents: 0, avgAttendance: 0, totalDuration: 0 };
      return;
    }
    const filteredIds = new Set(this.filteredMeetings.map(m => m._id));
    const uniqueStudents = new Set<string>();
    this.allMeetings.filter(m => filteredIds.has(m._id)).forEach(m => {
      m.attendees?.forEach((a: any) => {
        const id = a.studentId?._id || a.studentId;
        if (id) uniqueStudents.add(id.toString());
      });
    });
    this.stats = {
      totalMeetings: this.filteredMeetings.length,
      totalStudents: uniqueStudents.size,
      avgAttendance: Math.round(this.filteredMeetings.reduce((s, m) => s + m.attendanceRate, 0) / this.filteredMeetings.length),
      totalDuration: this.filteredMeetings.reduce((s, m) => s + m.duration, 0)
    };
  }

  onFilterChange(): void { this.applyFilters(); }

  clearFilters(): void {
    this.searchQuery = '';
    this.teacherFilter = 'all';
    this.batchFilter = 'all';
    this.dateFilter = 'all';
    this.customDateFrom = '';
    this.customDateTo = '';
    this.applyFilters();
  }

  getUniqueTeachers(): string[] {
    return [...new Set(this.completedMeetings.map(m => m.teacher.name))].sort();
  }

  getUniqueBatches(): string[] {
    return [...new Set(this.completedMeetings.map(m => m.batch))].sort();
  }

  viewMeetingDetails(id: string): void { this.router.navigate(['/teacher/meetings', id]); }
  viewAttendance(id: string): void { this.router.navigate(['/teacher/meetings', id, 'attendance']); }

  deleteMeeting(id: string, topic: string): void {
    if (!confirm(`Delete "${topic}"? This cannot be undone.`)) return;
    this.zoomService.deleteMeeting(id).subscribe({
      next: () => {
        this.allMeetings = this.allMeetings.filter(m => m._id !== id);
        this.completedMeetings = this.completedMeetings.filter(m => m._id !== id);
        this.applyFilters();
      },
      error: () => alert('Failed to delete. Please try again.')
    });
  }

  formatDateShort(date: Date): string {
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m} min`;
  }

  exportToCSV(): void {
    if (!this.filteredMeetings.length) { alert('No data to export'); return; }
    const headers = ['Date', 'Topic', 'Teacher', 'Batch', 'Duration (min)', 'Total', 'Attended', 'Absent', 'Rate (%)'];
    const rows = this.filteredMeetings.map(m => [
      this.formatDateShort(m.startTime), m.topic, m.teacher.name, m.batch,
      m.duration, m.attendees, m.attended, m.absent, m.attendanceRate
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `zoom_reports_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  }

  exportTeacherReport(): void {
    if (!this.completedMeetings.length) { alert('No data to export'); return; }
    const map: any = {};
    this.completedMeetings.forEach(m => {
      if (!map[m.teacher.name]) map[m.teacher.name] = { name: m.teacher.name, email: m.teacher.email, meetings: 0, duration: 0, students: 0, attended: 0 };
      map[m.teacher.name].meetings++;
      map[m.teacher.name].duration += m.duration;
      map[m.teacher.name].students += m.attendees;
      map[m.teacher.name].attended += m.attended;
    });
    const headers = ['Teacher', 'Email', 'Meetings', 'Duration (min)', 'Students', 'Attended', 'Avg Rate (%)'];
    const rows = Object.values(map).map((s: any) => [
      s.name, s.email, s.meetings, s.duration, s.students, s.attended,
      s.students > 0 ? Math.round((s.attended / s.students) * 100) : 0
    ]);
    const csv = [headers, ...rows].map((r: any) => r.map((c: any) => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `teacher_report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  }
}
