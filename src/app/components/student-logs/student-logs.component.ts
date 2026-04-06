import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StudentLogService, StudentLog } from '../../services/student-log.service';
import { Router } from '@angular/router';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-student-logs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './student-logs.component.html',
  styleUrls: ['./student-logs.component.css']
})
export class StudentLogsComponent implements OnInit {

  studentLogs: StudentLog[] = [];
  filteredLogs: StudentLog[] = [];
  paginatedData: StudentLog[] = [];
  isLoading = false;

  // Filters
  filters = {
    regNo: '',
    levelAtUpdate: '',
    batchAtUpdate: '',
    subscriptionAtUpdate: '',
    mediumAtUpdate: '',
    assignTeacherAtUpdate: ''
  };

  // Dropdown options
  regNo: string[] = [];
  levels: string[] = [];
  batches: string[] = [];
  subscriptions: string[] = [];
  mediums: string[] = [];
  teachers: string[] = [];

  // Pagination
  currentPage = 1;
  pageSize = 10;
  totalPages = 0;

  constructor(
    private studentLogService: StudentLogService,
    private router: Router,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadLogs();
  }

  loadLogs(): void {
    this.isLoading = true;
    this.studentLogService.getAllStudentLogs().subscribe({
      next: res => {
        this.studentLogs = res.data;

        // Populate filter options dynamically
        this.regNo = [...new Set(this.studentLogs.map(log => log.studentId.regNo).filter((r): r is string => !!r))];
        this.levels = [...new Set(this.studentLogs.map(log => log.levelAtUpdate).filter((l): l is string => !!l))];
        this.batches = [...new Set(this.studentLogs.map(log => log.batchAtUpdate).filter((b): b is string => !!b))];
        this.subscriptions = [...new Set(this.studentLogs.map(log => log.subscriptionAtUpdate).filter((s): s is string => !!s))];
        this.mediums = [
          ...new Set(
            this.studentLogs
              .map(log => Array.isArray(log.mediumAtUpdate) ? log.mediumAtUpdate : [log.mediumAtUpdate])
              .flat()
              .filter((m): m is string => !!m)
          )
        ];
        this.teachers = [...new Set(this.studentLogs.map(log => log.assignedTeacherAtUpdate?.name).filter((t): t is string => !!t))];

        this.applyFilters();
        this.isLoading = false;
      },
      error: err => {
        console.error(err);
        this.isLoading = false;
      }
    });
  }

  applyFilters(): void {
    this.filteredLogs = this.studentLogs.filter(log => {
      return (!this.filters.regNo || log.studentId.regNo === this.filters.regNo) &&
             (!this.filters.levelAtUpdate || log.levelAtUpdate === this.filters.levelAtUpdate) &&
             (!this.filters.batchAtUpdate || log.batchAtUpdate === this.filters.batchAtUpdate) &&
             (!this.filters.subscriptionAtUpdate || log.subscriptionAtUpdate === this.filters.subscriptionAtUpdate) &&
             (!this.filters.mediumAtUpdate ||
               (Array.isArray(log.mediumAtUpdate)
                 ? log.mediumAtUpdate.includes(this.filters.mediumAtUpdate)
                 : log.mediumAtUpdate === this.filters.mediumAtUpdate)
             ) &&
             (!this.filters.assignTeacherAtUpdate || log.assignedTeacherAtUpdate?.name === this.filters.assignTeacherAtUpdate);
    });

    this.currentPage = 1;
    this.calculatePagination();
  }

  clearFilters(): void {
    this.filters = { regNo: '', levelAtUpdate: '', batchAtUpdate: '', subscriptionAtUpdate: '', mediumAtUpdate: '', assignTeacherAtUpdate: '' };
    this.applyFilters();
  }

  calculatePagination(): void {
    this.totalPages = Math.ceil(this.filteredLogs.length / this.pageSize);
    this.paginatedData = this.filteredLogs.slice(
      (this.currentPage - 1) * this.pageSize,
      this.currentPage * this.pageSize
    );
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.calculatePagination();
  }

  formatDateTime(dateStr: string): string {
    return new Date(dateStr).toLocaleString();
  }

  openAnalytics(log: StudentLog): void {
    const studentId = log.studentId?._id;
    if (!studentId) return;
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/student-logs', studentId, 'analytics'])
    );
    window.open(url, '_blank');
  }

  deleteLog(log: StudentLog): void {
    if (!log._id) return;
    this.notify.confirm('Delete Log', `Delete this log for ${log.studentId?.name || 'student'}?`, 'Yes, Delete', 'Cancel').subscribe(ok => {
      if (!ok) return;
      this.studentLogService.deleteStudentLog(log._id!).subscribe({
        next: () => { this.studentLogs = this.studentLogs.filter((x) => x._id !== log._id); this.applyFilters(); },
        error: (err) => { console.error(err); this.notify.error(err?.error?.message || 'Failed to delete log'); }
      });
    });
  }
}
