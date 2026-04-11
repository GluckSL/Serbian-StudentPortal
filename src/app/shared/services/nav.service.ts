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
  private readonly SUB_ADMIN_DEFAULT_PERMISSIONS: string[] = ['dashboard', 'profile'];

  // ── ADMIN ──────────────────────────────────────────────────────────────
  private readonly ADMIN_NAV: NavGroup[] = [
    {
      group: 'Dashboard',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: '🏠', route: '/admin-dashboard', subGroup: null },
        { id: 'analytic-dash', label: 'Analytic dash', icon: '📈', route: '/admin/analytic-dash', subGroup: 'Featured' }
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
        { id: 'exercises', label: 'Online Exercises',  icon: '🏋️', route: '/admin/digital-exercises', subGroup: null },
        { id: 'journey',   label: 'Journey',           icon: '📅', route: '/admin/journey',           subGroup: null }
      ]
    },
    {
      group: 'Classes & Attendance',
      items: [
        { id: 'manage-classes', label: 'Manage Classes', icon: '🎥', route: '/teacher/meetings',    subGroup: null },
        { id: 'attendance',     label: 'Attendance',     icon: '📊', route: '/admin/zoom-reports',   subGroup: null },
        { id: 'import-meeting', label: 'Import Meeting', icon: '🔗', route: '/admin/external-meetings', subGroup: null },
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
        { id: 'payments', label: 'Payments', icon: '💳', route: '/admin/payments', subGroup: null },
        { id: 'invoices', label: 'Invoices', icon: '🧾', route: '/admin/invoices', subGroup: null },
        { id: 'payment-approvals', label: 'Payment Approvals', icon: '✅', route: '/admin/payment-approvals', subGroup: null }
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
      group: 'Support',
      items: [
        { id: 'support-tickets', label: 'Support Tickets', icon: '🎫', route: '/admin/support-tickets', subGroup: null },
        { id: 'help', label: 'Help & Support', icon: '❓', route: '/help', subGroup: null }
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
      group: 'My Analytics',
      items: [
        { id: 'my-analytics', label: 'My Analytics', icon: '📊', route: '/my-analytics', subGroup: null }
      ]
    },
    {
      group: 'Help',
      items: [
        { id: 'help', label: 'Help & Support', icon: '🎫', route: '/help', subGroup: null }
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
      group: 'My Course',
      items: [
        { id: 'my-course', label: 'My Course', icon: '📖', route: '/student/my-course', subGroup: null }
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
    },
    {
      group: 'Help',
      items: [
        { id: 'help', label: 'Help & Support', icon: '🎫', route: '/help', subGroup: null }
      ]
    }
  ];

  getNavForRole(role: string, sidebarPermissions: string[] = []): NavGroup[] {
    switch (role) {
      case 'ADMIN':
      case 'TEACHER_ADMIN':
        return this.ADMIN_NAV;
      case 'SUB_ADMIN':
        return this.getSubAdminNav(sidebarPermissions);
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
      SUB_ADMIN: '/admin-dashboard',
      TEACHER: '/teacher-dashboard',
      STUDENT: '/student-progress'
    };
    return map[role] || '/home';
  }

  getAllAdminNavItems(): NavItem[] {
    return this.ADMIN_NAV.flatMap(group => group.items);
  }

  getAdminNavGroups(): NavGroup[] {
    return this.ADMIN_NAV.map(group => ({
      group: group.group,
      items: group.items.map(item => ({ ...item }))
    }));
  }

  normalizeSidebarPermissions(sidebarPermissions: string[] = []): string[] {
    const validIds = new Set(this.getAllAdminNavItems().map(item => item.id));
    const normalized = Array.from(
      new Set(
        (sidebarPermissions || []).filter(permissionId => validIds.has(permissionId))
      )
    );

    for (const defaultPermission of this.SUB_ADMIN_DEFAULT_PERMISSIONS) {
      if (!normalized.includes(defaultPermission)) {
        normalized.push(defaultPermission);
      }
    }

    return normalized;
  }

  canSubAdminAccessRoute(route: string, sidebarPermissions: string[] = []): boolean {
    const normalizedPermissions = this.normalizeSidebarPermissions(sidebarPermissions);
    const allowedItems = this.getAllAdminNavItems().filter(item =>
      normalizedPermissions.includes(item.id)
    );

    const normalizedRoute = this.normalizeRoute(route);
    return allowedItems.some(item => this.routeMatches(item.route, normalizedRoute));
  }

  private getSubAdminNav(sidebarPermissions: string[]): NavGroup[] {
    const allowedPermissionIds = new Set(this.normalizeSidebarPermissions(sidebarPermissions));
    return this.ADMIN_NAV
      .map(group => ({
        ...group,
        items: group.items.filter(item => allowedPermissionIds.has(item.id))
      }))
      .filter(group => group.items.length > 0);
  }

  private routeMatches(allowedRoute: string, currentRoute: string): boolean {
    const normalizedAllowed = this.normalizeRoute(allowedRoute);
    return (
      currentRoute === normalizedAllowed ||
      currentRoute.startsWith(`${normalizedAllowed}/`)
    );
  }

  private normalizeRoute(route: string): string {
    const withoutQuery = (route || '').split('?')[0].split('#')[0];
    return withoutQuery.replace(/\/+$/, '') || '/';
  }
}
