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

export type AccessLevel = 'view' | 'edit' | 'full';

@Injectable({ providedIn: 'root' })
export class NavService {
  private readonly SUB_ADMIN_DEFAULT_PERMISSIONS: string[] = ['dashboard', 'profile'];
  private readonly SUB_ADMIN_ROUTE_ALIASES: Record<string, string[]> = {
    modules: [
      '/learning-modules',
      '/module-creation-choice',
      '/create-module',
      '/create-module-ai',
      '/create-roleplay-module',
      '/edit-module',
      '/ai-tutor-chat'
    ],
    exercises: [
      '/admin/digital-exercises',
      '/admin/digital-exercises/create',
      '/admin/digital-exercises/create-video',
      '/admin/digital-exercises/generate-ai',
      '/admin/digital-exercises/generate-listening-manual'
    ],
    'manage-classes': [
      '/teacher/meetings'
    ],
    journey: [
      '/admin/journey'
    ],
    'go-students': [
      '/admin/go-students'
    ]
  };

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
        { id: 'modules',   label: 'Learning Modules', icon: '🤖', route: '/admin-modules',             subGroup: 'Module Management' },
        { id: 'exercises', label: 'Online Exercises', icon: '🏋️', route: '/admin/digital-exercises',   subGroup: null },
        { id: 'journey',           label: 'Journey',            icon: '📅', route: '/admin/journey',             subGroup: null },
        { id: 'go-students',       label: 'GO Students',        icon: '🚀', route: '/admin/go-students',         subGroup: null }
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
        { id: 'whatsapp-announcement', label: 'WhatsApp Announcement', icon: '💬', route: '/admin/whatsapp-announcement', subGroup: null },
        { id: 'reminders', label: 'Reminders', icon: '⏰', route: '/admin/reminders', subGroup: null },
        { id: 'announcements', label: 'Announcements', icon: '📢', route: '/admin/announcements', subGroup: null },
        { id: 'support-tickets', label: 'Support Tickets', icon: '🎫', route: '/admin/support-tickets', subGroup: null },
        { id: 'help', label: 'Help & Support', icon: '❓', route: '/help', subGroup: null }
      ]
    },
    {
      group: 'System',
      items: [
        { id: 'test-accounts', label: 'Test Accounts', icon: '🧪', route: '/admin/test-accounts', subGroup: null }
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
        { id: 'students', label: 'Students', icon: '👥', route: '/teacher-dashboard', subGroup: null },
        { id: 'my-classes', label: 'My Classes', icon: '📚', route: '/teacher-dashboard/my-classes', subGroup: null }
      ]
    },
    {
      group: 'Learning',
      items: [
        { id: 'modules',   label: 'Learning Modules', icon: '🤖', route: '/learning-modules',         subGroup: 'Module Management' },
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
        { id: 'announcements', label: 'Announcements', icon: '📢', route: '/admin/announcements', subGroup: null },
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
        { id: 'my-course', label: 'My Course', icon: '📖', route: '/student/my-course', subGroup: null },
        { id: 'student-announcements', label: 'Announcements', icon: '📢', route: '/student/announcements', subGroup: null }
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

  getNavForRole(
    role: string,
    sidebarPermissions: string[] = [],
    teacherTabPermissions: string[] = [],
    sidebarAccessLevels: Record<string, AccessLevel> = {},
    teacherTabAccessLevels: Record<string, AccessLevel> = {}
  ): NavGroup[] {
    switch (role) {
      case 'ADMIN':
      case 'TEACHER_ADMIN':
        return this.ADMIN_NAV;
      case 'SUB_ADMIN':
        return this.getSubAdminNav(sidebarPermissions, sidebarAccessLevels);
      case 'TEACHER':
        return (teacherTabPermissions.length > 0 || Object.keys(teacherTabAccessLevels || {}).length > 0)
          ? this.getTeacherNavWithTabs(teacherTabPermissions, teacherTabAccessLevels)
          : this.TEACHER_NAV;
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

  normalizeAccessLevels(accessLevels: Record<string, any> | null | undefined): Record<string, AccessLevel> {
    const validIds = new Set(this.getAllAdminNavItems().map(item => item.id));
    const normalized: Record<string, AccessLevel> = {};
    if (!accessLevels || typeof accessLevels !== 'object') return normalized;

    for (const [tabId, level] of Object.entries(accessLevels)) {
      if (!validIds.has(tabId)) continue;
      if (level === 'view' || level === 'edit' || level === 'full') {
        normalized[tabId] = level;
      }
    }
    return normalized;
  }

  canAccessLevel(current: AccessLevel | undefined, required: AccessLevel): boolean {
    const rank: Record<AccessLevel, number> = { view: 1, edit: 2, full: 3 };
    if (!current) return false;
    return rank[current] >= rank[required];
  }

  getTabAccessLevel(
    tabId: string,
    accessLevels: Record<string, AccessLevel> = {},
    fallbackPermissions: string[] = []
  ): AccessLevel | null {
    const normalized = this.normalizeAccessLevels(accessLevels);
    if (normalized[tabId]) return normalized[tabId];
    return (fallbackPermissions || []).includes(tabId) ? 'view' : null;
  }

  // ── Teacher tab permissions (view/edit/full) ───────────────────────────────

  normalizeTeacherTabPermissions(
    permissions: string[] = [],
    teacherTabAccessLevels: Record<string, AccessLevel> = {}
  ): string[] {
    const validIds = new Set(this.getAllAdminNavItems().map(item => item.id));
    const fromLegacyList = (permissions || []).filter(id => validIds.has(id));
    const fromAccessLevels = Object.entries(this.normalizeAccessLevels(teacherTabAccessLevels))
      .filter(([, level]) => this.canAccessLevel(level, 'view'))
      .map(([id]) => id)
      .filter((id) => validIds.has(id));
    return Array.from(new Set([...fromLegacyList, ...fromAccessLevels]));
  }

  canTeacherAccessAdminRoute(
    route: string,
    teacherTabPermissions: string[] = [],
    teacherTabAccessLevels: Record<string, AccessLevel> = {}
  ): boolean {
    const allowedIds = new Set(
      this.normalizeTeacherTabPermissions(teacherTabPermissions, teacherTabAccessLevels)
    );
    const allowedItems = this.getAllAdminNavItems().filter(item => allowedIds.has(item.id));
    const normalizedRoute = this.normalizeRoute(route);
    return allowedItems.some(item => this.routeMatches(item.route, normalizedRoute));
  }

  private getTeacherNavWithTabs(
    teacherTabPermissions: string[],
    teacherTabAccessLevels: Record<string, AccessLevel> = {}
  ): NavGroup[] {
    const allowedIds = new Set(
      this.normalizeTeacherTabPermissions(teacherTabPermissions, teacherTabAccessLevels)
    );

    const baseNav: NavGroup[] = this.TEACHER_NAV.map((g) => ({
      ...g,
      items: g.items.map((i) => ({ ...i }))
    }));

    if (allowedIds.has('journey')) {
      const journeyItem = this.getAllAdminNavItems().find((i) => i.id === 'journey');
      const learningIdx = baseNav.findIndex((g) => g.group === 'Learning');
      if (journeyItem && learningIdx >= 0) {
        const learning = baseNav[learningIdx];
        const hasJourney = learning.items.some((i) => i.id === 'journey');
        if (!hasJourney) {
          baseNav[learningIdx] = {
            ...learning,
            items: [...learning.items, { ...journeyItem, label: 'Journey' }]
          };
        }
      }
    }

    const assignedAdminGroups: NavGroup[] = this.ADMIN_NAV
      .map((group) => ({
        ...group,
        group: `${group.group} (Assigned Access)`,
        items: group.items.filter((item) => allowedIds.has(item.id) && item.id !== 'journey')
      }))
      .filter((group) => group.items.length > 0);

    return [...baseNav, ...assignedAdminGroups];
  }

  // ── Sub-Admin permissions ─────────────────────────────────────────────────

  normalizeSidebarPermissions(
    sidebarPermissions: string[] = [],
    sidebarAccessLevels: Record<string, AccessLevel> = {}
  ): string[] {
    const validIds = new Set(this.getAllAdminNavItems().map(item => item.id));
    const normalizedAccessLevels = this.normalizeAccessLevels(sidebarAccessLevels);
    const normalized = Array.from(
      new Set(
        [
          ...(sidebarPermissions || []).filter(permissionId => validIds.has(permissionId)),
          ...Object.entries(normalizedAccessLevels)
            .filter(([, level]) => this.canAccessLevel(level, 'view'))
            .map(([permissionId]) => permissionId)
            .filter(permissionId => validIds.has(permissionId))
        ]
      )
    );

    for (const defaultPermission of this.SUB_ADMIN_DEFAULT_PERMISSIONS) {
      if (!normalized.includes(defaultPermission)) {
        normalized.push(defaultPermission);
      }
    }

    return normalized;
  }

  canSubAdminAccessRoute(
    route: string,
    sidebarPermissions: string[] = [],
    sidebarAccessLevels: Record<string, AccessLevel> = {}
  ): boolean {
    const normalizedPermissions = this.normalizeSidebarPermissions(sidebarPermissions, sidebarAccessLevels);
    const allowedItems = this.getAllAdminNavItems().filter(item =>
      normalizedPermissions.includes(item.id)
    );

    const normalizedRoute = this.normalizeRoute(route);
    return allowedItems.some(item => {
      if (this.routeMatches(item.route, normalizedRoute)) return true;
      const aliases = this.SUB_ADMIN_ROUTE_ALIASES[item.id] || [];
      return aliases.some(alias => this.routeMatches(alias, normalizedRoute));
    });
  }

  private getSubAdminNav(
    sidebarPermissions: string[],
    sidebarAccessLevels: Record<string, AccessLevel> = {}
  ): NavGroup[] {
    const allowedPermissionIds = new Set(
      this.normalizeSidebarPermissions(sidebarPermissions, sidebarAccessLevels)
    );
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
