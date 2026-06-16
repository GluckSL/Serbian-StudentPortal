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
      '/ai-tutor-chat',
      '/admin/dg-modules',
      '/admin/sprechen-exam'
    ],
    exercises: [
      '/admin/digital-exercises',
      '/admin/digital-exercises/create',
      '/admin/digital-exercises/create-video',
      // '/admin/digital-exercises/generate-ai', // DISABLED: PDF worksheet extractor route
      '/admin/digital-exercises/generate-listening-manual'
    ],
    'manage-classes': [
      '/teacher/meetings'
    ],
    'gluck-room': ['/gluck-room'],
    journey: [
      '/admin/journey'
    ],
    'portal-analytics': ['/portal-analytics', '/portal-analytics/daily-logs'],
    'language-tracking': ['/admin/language-tracking'],
    'go-students': [
      '/admin/go-students'
    ],
    'go-students-sinhala': [
      '/admin/go-students'
    ],
    'finance-dashboard': [
      '/admin/finance-dashboard',
      '/admin/finance-dashboard/batches',
      '/admin/payment-hub/insights/batches'
    ],
    'enrollment-overview': [
      '/admin/enrollment-overview'
    ],
    'krish-dashboard': [
      '/admin/enrollment-overview'
    ],
    'enrollment-overdue': [
      '/admin/enrollment-overview'
    ],
    'class-recordings': [
      '/class-recordings/approval-requests',
      '/class-recordings/access-recording',
      '/class-recordings/self-pace'
    ]
  };
  private readonly TEACHER_ROUTE_ALIASES: Record<string, string[]> = {
    'teacher-resources': ['/teacher/resources']
  };

  // ── ADMIN ──────────────────────────────────────────────────────────────
  private readonly ADMIN_NAV: NavGroup[] = [
    {
      group: 'Dashboard',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', route: '/admin-dashboard', subGroup: null }
      ]
    },
    {
      group: 'People',
      items: [
        { id: 'students',     label: 'Students',     icon: 'school', route: '/admin-dashboard',  subGroup: 'Student Management' },
        { id: 'portal-analytics', label: 'Portal Analytics', icon: 'analytics', route: '/portal-analytics', subGroup: 'Student Management' },
        { id: 'teachers',     label: 'Teachers',     icon: 'group', route: '/teachers',        subGroup: 'Teacher Management' },
        { id: 'user-roles',   label: 'User Roles',   icon: 'key', route: '/user-roles',       subGroup: null }
      ]
    },
    {
      group: 'Learning',
      items: [
        { id: 'dg-bot',    label: 'DG Bot Modules',   icon: 'pets', route: '/admin/dg-modules',          subGroup: 'Module Management' },
        { id: 'sprechen-exam', label: 'Sprechen Exam',  icon: 'record_voice_over', route: '/admin/sprechen-exam', subGroup: 'Module Management' },
        { id: 'exercises', label: 'Online Exercises', icon: 'fitness_center', route: '/admin/digital-exercises',   subGroup: null },
        { id: 'glueck-arena', label: 'GlückArena', icon: 'sports_esports', route: '/admin/glueck-arena', subGroup: null },
        { id: 'glueck-arena-analytics', label: 'Arena Analytics', icon: 'insights', route: '/admin/glueck-arena/analytics', subGroup: null },
        { id: 'glueck-arena-command', label: 'Arena Command Center', icon: 'dashboard', route: '/admin/glueck-arena/command-center', subGroup: null },
        { id: 'glueck-arena-teacher', label: 'Arena Teacher Insights', icon: 'school', route: '/admin/glueck-arena/teacher-analytics', subGroup: null },
        { id: 'bf-team-battles', label: 'Team Battles', icon: 'groups', route: '/admin/glueck-arena/battlefield/team-battles', subGroup: null },
        { id: 'teacher-resources', label: 'Teacher Resources', icon: 'folder_shared', route: '/admin/teacher-resources', subGroup: null },
        { id: 'journey',           label: 'Journey',            icon: 'map', route: '/admin/journey',             subGroup: null },
        { id: 'go-students',       label: 'GO Students',        icon: 'rocket_launch', route: '/admin/go-students',         subGroup: null }
      ]
    },
    {
      group: 'Classes & Attendance',
      items: [
        { id: 'manage-classes', label: 'Manage Classes', icon: 'videocam', route: '/teacher/meetings',    subGroup: null },
        { id: 'gluck-room', label: 'Gluck Room', icon: 'meeting_room', route: '/gluck-room', subGroup: null },
        { id: 'attendance',     label: 'Attendance',     icon: 'bar_chart', route: '/admin/zoom-reports',   subGroup: null },
        { id: 'import-meeting', label: 'Import Meeting', icon: 'link', route: '/admin/external-meetings', subGroup: null },
        { id: 'class-recordings', label: 'Class Recordings', icon: 'videocam', route: '/class-recordings', subGroup: null }
      ]
    },
    {
      group: 'AI Bot Report',
      items: [
        { id: 'ai-bot-report', label: 'AI Bot Report', icon: 'insights', route: '/admin-analytics', subGroup: null }
      ]
    },
    {
      group: 'Documents',
      items: [
        { id: 'documents', label: 'Documents', icon: 'description', route: '/admin/document-verification', subGroup: null },
        { id: 'google-sheet-sync', label: 'Sheet Sync', icon: 'table_chart', route: '/admin/google-sheet-sync', subGroup: null }
      ]
    },
    {
      group: 'Visa Tracking',
      items: [
        { id: 'visa-tracking', label: 'Visa Tracking', icon: 'flight', route: '/admin/visa-tracking', subGroup: null }
      ]
    },
    {
      group: 'Student Progress',
      items: [
        { id: 'student-progress', label: 'Student Progress', icon: 'trending_up', route: '/admin/student-progress', subGroup: null },
        { id: 'admin-performance', label: 'Performance', icon: 'speed', route: '/admin/performance', subGroup: null },
        { id: 'language-tracking', label: 'Language Tracking', icon: 'translate', route: '/admin/language-tracking', subGroup: null }
      ]
    },
    {
      group: 'Sales',
      items: [
        { id: 'enrollment-overview', label: 'Enrollment Overview', icon: 'storefront', route: '/admin/enrollment-overview', subGroup: null }
      ]
    },
    {
      group: 'Payments',
      items: [
        { id: 'finance-dashboard', label: 'Finance Dashboard', icon: 'account_balance_wallet', route: '/admin/finance-dashboard', subGroup: null },
        { id: 'payment-hub', label: 'Payment Hub (New)', icon: 'credit_card', route: '/admin/payment-hub', subGroup: null },
        { id: 'payment-request', label: 'Req Payment', icon: 'send', route: '/admin/payment-request', subGroup: null },
        // Legacy payment tabs hidden — use Payment Hub (New) instead
        // { id: 'payments', label: 'Payments', icon: 'payments', route: '/admin/payments', subGroup: null },
        // { id: 'invoices', label: 'Invoices', icon: 'receipt_long', route: '/admin/invoices', subGroup: null },
        // { id: 'payment-approvals', label: 'Payment Approvals', icon: 'check_circle', route: '/admin/payment-approvals', subGroup: null }
      ]
    },
    {
      group: 'Timetable',
      items: [
        { id: 'timetable', label: 'Timetable', icon: 'calendar_today', route: '/time-table-view-admin', subGroup: null }
      ]
    },
    {
      group: 'CRM Sync',
      items: [
        { id: 'monday-sync', label: 'Monday.com Preview', icon: 'sync', route: '/admin/monday-sync-preview', subGroup: null }
      ]
    },
    {
      group: 'Support',
      items: [
        { id: 'reminders', label: 'Reminders', icon: 'alarm', route: '/admin/reminders', subGroup: null },
        { id: 'announcements', label: 'Announcements', icon: 'campaign', route: '/admin/announcements', subGroup: null },
        { id: 'job-openings', label: 'Job Openings', icon: 'work', route: '/admin/job-openings', subGroup: null },
        { id: 'support-tickets', label: 'Support Tickets', icon: 'confirmation_number', route: '/admin/support-tickets', subGroup: null },
        { id: 'olly-chat', label: 'Olly Live Chat 🦊', icon: 'forum', route: '/admin/olly-chat', subGroup: null },
        { id: 'help', label: 'Help & Support', icon: 'help', route: '/help', subGroup: null }
      ]
    },
    {
      group: 'System',
      items: [
        { id: 'test-accounts', label: 'Test Accounts', icon: 'science', route: '/admin/test-accounts', subGroup: null }
      ]
    },
    {
      group: 'Profile',
      items: [
        { id: 'profile', label: 'Profile', icon: 'person', route: '/profile', subGroup: null }
      ]
    }
  ];

  // ── TEACHER ────────────────────────────────────────────────────────────
  // No Dashboard for teacher — redirects to students
  private readonly TEACHER_NAV: NavGroup[] = [
    {
      group: 'Students',
      items: [
        { id: 'students', label: 'Students', icon: 'groups', route: '/teacher-dashboard', subGroup: null },
        { id: 'my-classes', label: 'My Classes', icon: 'class', route: '/teacher-dashboard/my-classes', subGroup: null }
      ]
    },
    {
      group: 'Learning',
      items: [
        { id: 'dg-bot',    label: 'DG Bot Modules',   icon: 'pets', route: '/admin/dg-modules',        subGroup: 'Module Management' },
        { id: 'sprechen-exam', label: 'Sprechen Exam',  icon: 'record_voice_over', route: '/admin/sprechen-exam', subGroup: 'Module Management' },
        { id: 'exercises', label: 'Online Exercises',  icon: 'fitness_center', route: '/admin/digital-exercises', subGroup: null },
        { id: 'glueck-arena', label: 'GlückArena', icon: 'sports_esports', route: '/admin/glueck-arena', subGroup: null },
        { id: 'glueck-arena-teacher', label: 'Arena Teacher Insights', icon: 'school', route: '/admin/glueck-arena/teacher-analytics', subGroup: null },
        { id: 'bf-team-battles', label: 'Team Battles', icon: 'groups', route: '/admin/glueck-arena/battlefield/team-battles', subGroup: null }

      ]
    },
    {
      group: 'AI Bot Report',
      items: [
        { id: 'ai-bot-report', label: 'AI Bot Report', icon: 'insights', route: '/admin-analytics', subGroup: null }
      ]
    },
    {
      group: 'My Analytics',
      items: [
        { id: 'my-analytics', label: 'My Analytics', icon: 'analytics', route: '/my-analytics', subGroup: null }
      ]
    },
    {
      group: 'Help',
      items: [
        { id: 'announcements', label: 'Announcements', icon: 'campaign', route: '/admin/announcements', subGroup: null },
        { id: 'help', label: 'Help & Support', icon: 'help', route: '/help', subGroup: null }
      ]
    },
    {
      group: 'Timetable',
      items: [
        { id: 'timetable', label: 'Timetable', icon: 'calendar_today', route: '/time-table-view-teacher', subGroup: null }
      ]
    },
    {
      group: 'Profile',
      items: [
        { id: 'profile', label: 'Profile', icon: 'person', route: '/profile', subGroup: null }
      ]
    }
  ];

  // ── STUDENT ────────────────────────────────────────────────────────────
  // Profile merged into Dashboard. No separate AI Bot Report or Attendance nav items.
  private readonly STUDENT_NAV: NavGroup[] = [
    {
      group: 'Dashboard',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: 'home', route: '/student-progress', subGroup: null }
      ]
    },
    {
      group: 'Learning',
      items: [
        { id: 'my-course', label: 'My Course', icon: 'menu_book', route: '/student/my-course', subGroup: null },
        { id: 'gluck-room', label: 'Gluck Room', icon: 'meeting_room', route: '/student/gluck-room', subGroup: null },
        { id: 'glueck-arena', label: 'GlückArena', icon: 'sports_esports', route: '/glueck-arena', subGroup: null },
        { id: 'student-announcements', label: 'Announcements', icon: 'campaign', route: '/student/announcements', subGroup: null },
        { id: 'job-openings', label: 'Job Openings', icon: 'work', route: '/student/job-openings', subGroup: null },
        { id: 'performance', label: 'Performance History', icon: 'assessment', route: '/performance-history', subGroup: null }
      ]
    },
    {
      group: 'Documents',
      items: [
        { id: 'documents', label: 'Documents', icon: 'folder', route: '/student-documents', subGroup: null }
      ]
    },
    {
      group: 'Payments',
      items: [
        { id: 'my-payments', label: 'My Payments', icon: 'payments', route: '/my-payments', subGroup: null }
      ]
    },
    {
      group: 'Visa Status',
      items: [
        { id: 'visa-status', label: 'Visa Status', icon: 'flight', route: '/visa-status', subGroup: null }
      ]
    },
    {
      group: 'Timetable',
      items: [
        { id: 'timetable', label: 'Timetable', icon: 'calendar_today', route: '/time-table-view-student', subGroup: null }
      ]
    },
    {
      group: 'Help',
      items: [
        { id: 'help', label: 'Help & Support', icon: 'help', route: '/help', subGroup: null }
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

  normalizeSidebarDeletePermissions(
    deletePermissions: string[] = [],
    accessLevels: Record<string, AccessLevel> = {}
  ): string[] {
    const validIds = new Set(this.getAllAdminNavItems().map(item => item.id));
    const normalized: string[] = [];
    const levels = this.normalizeAccessLevels(accessLevels);

    for (const tabId of deletePermissions) {
      if (!validIds.has(tabId)) continue;
      const level = levels[tabId] || this.getTabAccessLevel(tabId, levels);
      if (this.canAccessLevel(level || undefined, 'edit')) {
        normalized.push(tabId);
      }
    }
    return Array.from(new Set(normalized));
  }

  /** SUB_ADMIN: edit access required; full always allows delete; otherwise tab must be in deletePermissions. */
  canDeleteOnTab(
    tabId: string,
    accessLevels: Record<string, AccessLevel> = {},
    deletePermissions: string[] = [],
    fallbackPermissions: string[] = []
  ): boolean {
    const level = this.getTabAccessLevel(tabId, accessLevels, fallbackPermissions);
    if (!this.canAccessLevel(level || undefined, 'edit')) return false;
    if (level === 'full') return true;
    return (deletePermissions || []).includes(tabId);
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
    return allowedItems.some(item => {
      if (this.routeMatches(item.route, normalizedRoute)) return true;
      const aliases = this.TEACHER_ROUTE_ALIASES[item.id] || [];
      return aliases.some(alias => this.routeMatches(alias, normalizedRoute));
    });
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
        items: group.items
          .filter((item) => allowedIds.has(item.id) && item.id !== 'journey')
          .map((item) =>
            item.id === 'teacher-resources'
              ? { ...item, label: 'Resources', route: '/teacher/resources' }
              : item
          )
      }))
      .filter((group) => group.items.length > 0);

    return [...baseNav, ...assignedAdminGroups];
  }

  // ── Sub-Admin permissions ─────────────────────────────────────────────────

  private readonly LEGACY_PERMISSION_ALIASES: Record<string, string> = {
    'krish-dashboard': 'enrollment-overview',
    'enrollment-overdue': 'enrollment-overview',
  };

  normalizeSidebarPermissions(
    sidebarPermissions: string[] = [],
    sidebarAccessLevels: Record<string, AccessLevel> = {}
  ): string[] {
    const validIds = new Set(this.getAllAdminNavItems().map(item => item.id));
    const remappedPermissions = (sidebarPermissions || []).map(
      (id) => this.LEGACY_PERMISSION_ALIASES[id] || id
    );
    const remappedAccessLevels = { ...sidebarAccessLevels };
    for (const [legacyId, nextId] of Object.entries(this.LEGACY_PERMISSION_ALIASES)) {
      if (remappedAccessLevels[legacyId] && !remappedAccessLevels[nextId]) {
        remappedAccessLevels[nextId] = remappedAccessLevels[legacyId];
      }
    }
    const normalizedAccessLevels = this.normalizeAccessLevels(remappedAccessLevels);
    const normalized = Array.from(
      new Set(
        [
          ...remappedPermissions.filter(permissionId => validIds.has(permissionId)),
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
