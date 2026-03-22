import { Injectable } from '@angular/core';

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  route: string;
  subGroup: string | null;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

@Injectable({ providedIn: 'root' })
export class NavService {

  // ── ADMIN ──────────────────────────────────────────────────────────────
  private readonly ADMIN_NAV: NavGroup[] = [
    {
      group: 'Dashboard',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: '🏠', route: '/admin-dashboard', subGroup: null }
      ]
    },
    {
      group: 'People',
      items: [
        { id: 'students',     label: 'Students',     icon: '🎓', route: '/admin-dashboard',  subGroup: 'Student Management' },
        { id: 'student-logs', label: 'Student Logs', icon: '📋', route: '/student-logs',     subGroup: 'Student Management' },
        { id: 'teachers',     label: 'Teachers',     icon: '🧑‍🏫', route: '/teachers',        subGroup: 'Teacher Management' },
        { id: 'user-roles',   label: 'User Roles',   icon: '🔑', route: '/user-roles',       subGroup: null }
      ]
    },
    {
      group: 'Learning',
      items: [
        { id: 'modules',   label: 'Learning Modules', icon: '🤖', route: '/admin-modules',          subGroup: 'Module Management' },
        { id: 'exercises', label: 'Online Exercises',  icon: '🏋️', route: '/admin/digital-exercises', subGroup: null }
      ]
    },
    {
      group: 'Classes & Attendance',
      items: [
        { id: 'manage-classes', label: 'Manage Classes', icon: '🎥', route: '/teacher/meetings',    subGroup: null },
        { id: 'attendance',     label: 'Attendance',     icon: '📊', route: '/admin/zoom-reports',   subGroup: null },
        { id: 'class-recordings', label: 'Class Recordings', icon: '📹', route: '/class-recordings', subGroup: null }
      ]
    },
    {
      group: 'AI Bot Report',
      items: [
        { id: 'ai-bot-report', label: 'AI Bot Report', icon: '📈', route: '/admin-analytics', subGroup: null }
      ]
    },
    {
      group: 'Documents',
      items: [
        { id: 'documents', label: 'Documents', icon: '📁', route: '/admin/document-verification', subGroup: null }
      ]
    },
    {
      group: 'Visa Tracking',
      items: [
        { id: 'visa-tracking', label: 'Visa Tracking', icon: '✈️', route: '/admin/visa-tracking', subGroup: null }
      ]
    },
    {
      group: 'Student Progress',
      items: [
        { id: 'student-progress', label: 'Student Progress', icon: '📊', route: '/admin/student-progress', subGroup: null }
      ]
    },
    {
      group: 'Payments',
      items: [
        { id: 'payments', label: 'Payments', icon: '💳', route: '/admin/payments', subGroup: null }
      ]
    },
    {
      group: 'Timetable',
      items: [
        { id: 'timetable', label: 'Timetable', icon: '📅', route: '/time-table-view-admin', subGroup: null }
      ]
    },
    {
      group: 'CRM Sync',
      items: [
        { id: 'monday-sync', label: 'Monday.com Preview', icon: '🔄', route: '/admin/monday-sync-preview', subGroup: null }
      ]
    },
    {
      group: 'Profile',
      items: [
        { id: 'profile', label: 'Profile', icon: '👤', route: '/profile', subGroup: null }
      ]
    }
  ];

  // ── TEACHER ────────────────────────────────────────────────────────────
  // No Dashboard for teacher — redirects to students
  private readonly TEACHER_NAV: NavGroup[] = [
    {
      group: 'Students',
      items: [
        { id: 'students', label: 'Students', icon: '👥', route: '/teacher-dashboard', subGroup: null }
      ]
    },
    {
      group: 'Learning',
      items: [
        { id: 'modules',   label: 'Learning Modules', icon: '🤖', route: '/learning-modules',          subGroup: 'Module Management' },
        { id: 'exercises', label: 'Online Exercises',  icon: '🏋️', route: '/admin/digital-exercises', subGroup: null }
      ]
    },
    {
      group: 'Classes & Attendance',
      items: [
        { id: 'manage-classes', label: 'Manage Classes', icon: '🎥', route: '/teacher/meetings', subGroup: null },
        { id: 'attendance',     label: 'Attendance',     icon: '📊', route: '/admin/zoom-reports', subGroup: null },
        { id: 'class-recordings', label: 'Class Recordings', icon: '📹', route: '/class-recordings', subGroup: null }
      ]
    },
    {
      group: 'AI Bot Report',
      items: [
        { id: 'ai-bot-report', label: 'AI Bot Report', icon: '📈', route: '/admin-analytics', subGroup: null }
      ]
    },
    {
      group: 'Timetable',
      items: [
        { id: 'timetable', label: 'Timetable', icon: '📅', route: '/time-table-view-teacher', subGroup: null }
      ]
    },
    {
      group: 'Profile',
      items: [
        { id: 'profile', label: 'Profile', icon: '👤', route: '/profile', subGroup: null }
      ]
    }
  ];

  // ── STUDENT ────────────────────────────────────────────────────────────
  // Profile merged into Dashboard. No separate AI Bot Report or Attendance nav items.
  private readonly STUDENT_NAV: NavGroup[] = [
    {
      group: 'Dashboard',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: '🏠', route: '/student-progress', subGroup: null }
      ]
    },
    {
      group: 'Learning',
      items: [
        { id: 'modules',   label: 'Learning Modules', icon: '🤖', route: '/learning-modules',    subGroup: 'Module Management' },
        { id: 'exercises', label: 'Online Exercises',  icon: '🏋️', route: '/digital-exercises',   subGroup: null }
      ]
    },
    {
      group: 'My Classes',
      items: [
        { id: 'classes', label: 'My Classes', icon: '🎥', route: '/student/meetings', subGroup: null },
        { id: 'class-recordings', label: 'Class Recordings', icon: '📹', route: '/student/class-recordings', subGroup: null }
      ]
    },
    {
      group: 'Performance History',
      items: [
        { id: 'performance', label: 'Performance History', icon: '📊', route: '/performance-history', subGroup: null }
      ]
    },
    {
      group: 'Documents',
      items: [
        { id: 'documents', label: 'Documents', icon: '📁', route: '/student-documents', subGroup: null }
      ]
    },
    {
      group: 'Payments',
      items: [
        { id: 'payments', label: 'Payments', icon: '💳', route: '/student-payments', subGroup: null }
      ]
    },
    {
      group: 'Visa Status',
      items: [
        { id: 'visa-status', label: 'Visa Status', icon: '✈️', route: '/visa-status', subGroup: null }
      ]
    },
    {
      group: 'Timetable',
      items: [
        { id: 'timetable', label: 'Timetable', icon: '📅', route: '/time-table-view-student', subGroup: null }
      ]
    }
  ];

  getNavForRole(role: string): NavGroup[] {
    switch (role) {
      case 'ADMIN':
      case 'TEACHER_ADMIN':
        return this.ADMIN_NAV;
      case 'TEACHER':
        return this.TEACHER_NAV;
      case 'STUDENT':
        return this.STUDENT_NAV;
      default:
        return [];
    }
  }

  getDashboardRoute(role: string): string {
    const map: Record<string, string> = {
      ADMIN: '/admin-dashboard',
      TEACHER_ADMIN: '/admin-dashboard',
      TEACHER: '/teacher-dashboard',
      STUDENT: '/student-progress'
    };
    return map[role] || '/home';
  }
}
