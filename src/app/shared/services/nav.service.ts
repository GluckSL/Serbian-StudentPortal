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
  private readonly SUB_ADMIN_DEFAULT_PERMISSIONS: string[] = ['profile'];
  /** Shared child-route patterns for v2-only tabs (edit/create/preview without granting v1 list). */
  private readonly V2_TAB_CHILD_ROUTE_PATTERNS: Record<string, RegExp[]> = {
    'exercises-v2': [
      /^\/admin\/digital-exercises\/create(?:\/|$)/,
      /^\/admin\/digital-exercises\/create-freemode(?:\/|$)/,
      /^\/admin\/digital-exercises\/create-video(?:\/|$)/,
      /^\/admin\/digital-exercises\/generate-listening-manual(?:\/|$)/,
      /^\/admin\/digital-exercises\/[^/]+\/edit(?:\/|$)/,
      /^\/digital-exercises\/[^/]+\/play(?:\/|$)/,
    ],
    'dg-bot-v2': [
      /^\/admin\/dg-modules\/new(?:\/|$)/,
      /^\/admin\/dg-modules\/[^/]+\/edit(?:\/|$)/,
      /^\/admin\/dg-modules\/[^/]+\/beginner-mode(?:\/|$)/,
      /^\/admin\/dg-modules\/[^/]+\/analytics(?:\/|$)/,
      /^\/dg-bot\/[^/]+\/play(?:\/|$)/,
    ],
  };
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
    'dg-bot': [
      '/admin/dg-modules/new',
      '/admin/dg-modules',
    ],
    'dg-bot-v2': [
      '/admin/dg-modules-v2',
    ],
    exercises: [
      '/admin/digital-exercises',
      '/admin/digital-exercises/create',
      '/admin/digital-exercises/create-freemode',
      '/admin/digital-exercises/create-video',
      // '/admin/digital-exercises/generate-ai', // DISABLED: PDF worksheet extractor route
      '/admin/digital-exercises/generate-listening-manual'
    ],
    'exercises-v2': [
      '/admin/digital-exercises-v2',
    ],
    'manage-classes': [
      '/teacher/meetings'
    ],
    'gluck-room': ['/gluck-room'],
    journey: [
      '/admin/journey'
    ],
    'batch-leaderboard': ['/admin/leaderboard'],
    'portal-analytics': ['/portal-analytics', '/portal-analytics/daily-logs'],
    'language-tracking': ['/admin/language-tracking'],
    'engagement-overview': ['/admin/engagement-overview'],
    'go-students': [
      '/admin/go-students'
    ],
    'go-students-sinhala': [
      '/admin/go-students'
    ],
    'finance-dashboard': [
      '/admin/finance-dashboard',
      '/admin/finance-dashboard/batches',
      '/admin/finance-dashboard/language-payment',
      '/admin/finance-dashboard/students',
      '/admin/finance-dashboard/silver-payment',
      '/admin/finance-dashboard/health-checkup',
      '/admin/payment-hub/student',
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
    ],
    attendance: [
      '/admin/attendance-dashboard',
    ],
    documents: [
      '/admin/document-verification',
      '/admin/university-applications',
      '/admin/agreements'
    ]
  };
  private readonly TEACHER_ROUTE_ALIASES: Record<string, string[]> = {
    'teacher-resources': ['/teacher/resources'],
    attendance: ['/admin/attendance-dashboard'],
  };

  // -- ADMIN ----------------------------------------------
  private readonly ADMIN_NAV: NavGroup[] = [

    // -- Overview --------------------------------------
    {
      group: 'Pregled',
      items: [
        { id: 'dashboard',  label: 'Kontrolna tabla', icon: 'dashboard', route: '/admin-dashboard', subGroup: null },
        { id: 'engagement-overview', label: 'Pregled grupe', icon: 'insights', route: '/admin/engagement-overview', subGroup: null },
        { id: 'students',   label: 'Ucenici',  icon: 'school',    route: '/admin/students',  subGroup: 'Upravljanje ucenicima' },
        { id: 'teachers',   label: 'Nastavnici',  icon: 'group',     route: '/teachers',        subGroup: 'Upravljanje nastavnicima' },
        { id: 'user-roles', label: 'Uloge korisnika', icon: 'key',      route: '/user-roles',      subGroup: null },
        { id: 'account-audit-log', label: 'Evidencija aktivnosti', icon: 'history', route: '/account-audit-log', subGroup: null },
        { id: 'crm',        label: 'CRM',        icon: 'hub',       route: '/admin/crm',       subGroup: null }
      ]
    },

    // -- Classes & Attendance -------------------------
    // Timetable ? live sessions ? attendance ? recordings � full class lifecycle
    {
      group: 'Casovi i prisustvo',
      items: [
        { id: 'timetable',        label: 'Raspored',        icon: 'calendar_today', route: '/time-table-view-admin',  subGroup: null },
        { id: 'manage-classes',   label: 'Upravljanje casovima',   icon: 'videocam',       route: '/teacher/meetings',       subGroup: null },
        { id: 'gluck-room',       label: 'Gluck soba',       icon: 'meeting_room',   route: '/gluck-room',             subGroup: null },
        { id: 'attendance',       label: 'Prisustvo',       icon: 'bar_chart',      route: '/admin/zoom-reports',     subGroup: null },
        { id: 'class-recordings', label: 'Snimci casova', icon: 'play_circle',    route: '/class-recordings',       subGroup: null }
      ]
    },

    // -- Learning Content ---------------------------------
    // Modules, exercises, and resources teachers use in lessons
    {
      group: 'Sadr�aj za ucenje',
      items: [
        { id: 'dg-bot',            label: 'DG Bot moduli',       icon: 'pets',             route: '/admin/dg-modules',        subGroup: 'Upravljanje modulima' },
        { id: 'dg-bot-v2',        label: 'DG Bot moduli 2.0',   icon: 'auto_awesome',     route: '/admin/dg-modules-v2',     subGroup: 'Upravljanje modulima' },
        { id: 'sprechen-exam',     label: 'Sprechen ispit',    icon: 'record_voice_over', route: '/admin/sprechen-exam',    subGroup: 'Upravljanje modulima' },
        { id: 'exercises',         label: 'Online ve�be',     icon: 'fitness_center',   route: '/admin/digital-exercises',    subGroup: null },
        { id: 'exercises-v2',      label: 'Online ve�be 2.0', icon: 'upgrade',          route: '/admin/digital-exercises-v2', subGroup: null },
        { id: 'teacher-resources', label: 'Resursi za nastavnike',     icon: 'folder_shared',    route: '/admin/teacher-resources',    subGroup: null },
        { id: 'correction',        label: 'Korekcija',       icon: 'build_circle',     route: '/admin/correction',        subGroup: null }
      ]
    },

    // -- Gl�ckArena -------------------------------------------
    // All arena game, analytics, and command tools in one place
    {
      group: 'Gl�ckArena',
      items: [
        { id: 'glueck-arena',           label: 'Arena',             icon: 'sports_esports', route: '/admin/glueck-arena',                          subGroup: null },
        { id: 'glueck-arena-command',   label: 'Komandni centar',    icon: 'tune',           route: '/admin/glueck-arena/command-center',           subGroup: null },
        { id: 'glueck-arena-analytics', label: 'Analitika arene',   icon: 'insights',       route: '/admin/glueck-arena/analytics',                subGroup: null },
        { id: 'glueck-arena-teacher',   label: 'Uvidi nastavnika',  icon: 'school',         route: '/admin/glueck-arena/teacher-analytics',        subGroup: null },
        { id: 'bf-team-battles',        label: 'Timske bitke',      icon: 'groups',         route: '/admin/glueck-arena/battlefield/team-battles', subGroup: null }
      ]
    },

    // -- Progress & Analytics ---------------------------
    // All reporting and tracking dashboards for student progress
    {
      group: 'Napredak i analitika',
      items: [
        { id: 'portal-analytics',  label: 'Analitika portala',  icon: 'analytics',   route: '/portal-analytics',       subGroup: 'Upravljanje ucenicima' },
        { id: 'student-progress',  label: 'Napredak ucenika',  icon: 'trending_up', route: '/admin/student-progress', subGroup: null },
        { id: 'admin-performance', label: 'Performanse',       icon: 'speed',       route: '/admin/performance',      subGroup: null },
        { id: 'language-tracking', label: 'Pracenje jezika', icon: 'translate',   route: '/admin/language-tracking', subGroup: null },
        { id: 'batch-leaderboard', label: 'Rang lista grupe', icon: 'leaderboard', route: '/admin/leaderboard',      subGroup: null },
        { id: 'journey',           label: 'Put',           icon: 'map',         route: '/admin/journey',          subGroup: null },
        { id: 'go-students',       label: 'GO Ucenici',       icon: 'rocket_launch', route: '/admin/go-students',    subGroup: null }
      ]
    },

    // -- Sales & Finance ----------------------------------------
    {
      group: 'Prodaja i finansije',
      items: [
        { id: 'enrollment-overview', label: 'Pregled upisa', icon: 'storefront',             route: '/admin/enrollment-overview', subGroup: null },
        { id: 'finance-dashboard',   label: 'Finansijska kontrolna tabla',   icon: 'account_balance_wallet', route: '/admin/finance-dashboard',   subGroup: null },
        { id: 'payment-hub',         label: 'Centar za placanje',         icon: 'credit_card',            route: '/admin/payment-hub',         subGroup: null },
        { id: 'payment-request',     label: 'Zahtev za placanje',     icon: 'send',                   route: '/admin/payment-request',     subGroup: null }
        // Legacy payment tabs hidden � use Payment Hub instead
        // { id: 'payments', label: 'Placanja', icon: 'payments', route: '/admin/payments', subGroup: null },
        // { id: 'invoices', label: 'Invoices', icon: 'receipt_long', route: '/admin/invoices', subGroup: null },
        // { id: 'payment-approvals', label: 'Payment Approvals', icon: 'check_circle', route: '/admin/payment-approvals', subGroup: null }
      ]
    },

    // -- Documents & Data --------------------------------------
    {
      group: 'Dokumenti i podaci',
      items: [
        { id: 'documents',         label: 'Dokumenti',          icon: 'description', route: '/admin/document-verification', subGroup: null },
        { id: 'google-sheet-sync', label: 'Sinhronizacija tabele',         icon: 'table_chart', route: '/admin/google-sheet-sync',     subGroup: null },
        // { id: 'monday-sync',       label: 'Monday.com Preview', icon: 'sync',        route: '/admin/monday-sync-preview',   subGroup: null },
        { id: 'visa-tracking',     label: 'Pracenje vize',      icon: 'flight',      route: '/admin/visa-tracking',         subGroup: null }
      ]
    },

    // -- Support & Comms ----------------------------------------
    {
      group: 'Podr�ka i komunikacija',
      items: [
        { id: 'announcements',   label: 'Obave�tenja',    icon: 'campaign',            route: '/admin/announcements',   subGroup: null },
        { id: 'job-openings',    label: 'Oglasi za posao',     icon: 'work',                route: '/admin/job-openings',    subGroup: null },
        { id: 'support-tickets', label: 'Tiketi za podr�ku',  icon: 'confirmation_number', route: '/admin/support-tickets', subGroup: null },
        { id: 'olly-chat',       label: 'Olly cet u�ivo ??', icon: 'forum',             route: '/admin/olly-chat',       subGroup: null },
        { id: 'class-feedback',  label: 'Povratne informacije o casu ??', icon: 'rate_review',       route: '/admin/class-feedback',  subGroup: null },
        { id: 'help',            label: 'Pomoc i podr�ka',   icon: 'help',                route: '/help',                  subGroup: null }
      ]
    },

    // -- System & Account --------------------------------------
    {
      group: 'Sistem',
      items: [
        { id: 'test-accounts', label: 'Test nalozi', icon: 'science', route: '/admin/test-accounts', subGroup: null },
        { id: 'profile',       label: 'Profil',       icon: 'person',  route: '/profile',             subGroup: null }
      ]
    }

  ];
  // -- TEACHER ------------------------------------------------------------
  // No Dashboard for teacher � redirects to students
  private readonly TEACHER_NAV: NavGroup[] = [
    {
      group: 'Ucenici',
      items: [
        { id: 'students', label: 'Ucenici', icon: 'groups', route: '/teacher-dashboard', subGroup: null },
        { id: 'my-classes', label: 'Moji casovi', icon: 'class', route: '/teacher-dashboard/my-classes', subGroup: null }
      ]
    },
    {
      group: 'Ucenje',
      items: [
        { id: 'dg-bot',    label: 'DG Bot moduli',   icon: 'pets', route: '/admin/dg-modules',        subGroup: 'Upravljanje modulima' },
        { id: 'dg-bot-v2', label: 'DG Bot moduli 2.0', icon: 'auto_awesome', route: '/admin/dg-modules-v2', subGroup: 'Upravljanje modulima' },
        { id: 'sprechen-exam', label: 'Sprechen ispit',  icon: 'record_voice_over', route: '/admin/sprechen-exam', subGroup: 'Upravljanje modulima' },
        { id: 'exercises',    label: 'Online ve�be',     icon: 'fitness_center', route: '/admin/digital-exercises',    subGroup: null },
        { id: 'exercises-v2', label: 'Online ve�be 2.0', icon: 'upgrade',        route: '/admin/digital-exercises-v2', subGroup: null },
        { id: 'glueck-arena', label: 'Gl�ckArena', icon: 'sports_esports', route: '/admin/glueck-arena', subGroup: null },
        { id: 'bf-team-battles', label: 'Timske bitke', icon: 'groups', route: '/admin/glueck-arena/battlefield/team-battles', subGroup: null }

      ]
    },
    {
      group: 'Moja analitika',
      items: [
        { id: 'my-analytics', label: 'Moja analitika', icon: 'analytics', route: '/my-analytics', subGroup: null }
      ]
    },
    {
      group: 'Pomoc',
      items: [
        { id: 'announcements', label: 'Obave�tenja', icon: 'campaign', route: '/admin/announcements', subGroup: null },
        { id: 'help', label: 'Pomoc i podr�ka', icon: 'help', route: '/help', subGroup: null }
      ]
    },
    {
      group: 'Raspored',
      items: [
        { id: 'timetable', label: 'Raspored', icon: 'calendar_today', route: '/time-table-view-teacher', subGroup: null }
      ]
    },
    {
      group: 'Gluck soba',
      items: [
        { id: 'gluck-room', label: 'Gluck soba', icon: 'meeting_room', route: '/gluck-room', subGroup: null }
      ]
    },
    {
      group: 'Profil',
      items: [
        { id: 'profile', label: 'Profil', icon: 'person', route: '/profile', subGroup: null }
      ]
    }
  ];

  // -- STUDENT ------------------------------------------------------------
  // Profile merged into Dashboard. No separate AI Bot Report or Attendance nav items.
  private readonly STUDENT_NAV: NavGroup[] = [
    {
      group: 'Kontrolna tabla',
      items: [
        { id: 'dashboard', label: 'Kontrolna tabla', icon: 'home', route: '/student-progress', subGroup: null }
      ]
    },
    {
      group: 'Ucenje',
      items: [
        { id: 'my-course', label: 'Moj kurs', icon: 'menu_book', route: '/student/my-course', subGroup: null },
        { id: 'glueck-arena', label: 'Gl�ckArena', icon: 'sports_esports', route: '/glueck-arena', subGroup: null },
        { id: 'student-announcements', label: 'Obave�tenja', icon: 'campaign', route: '/student/announcements', subGroup: null },
        { id: 'job-openings', label: 'Oglasi za posao', icon: 'work', route: '/student/job-openings', subGroup: null },
        { id: 'performance', label: 'Istorija napretka', icon: 'assessment', route: '/performance-history', subGroup: null }
      ]
    },
    {
      group: 'Gluck soba',
      items: [
        { id: 'gluck-room', label: 'Gluck soba', icon: 'meeting_room', route: '/student/gluck-room', subGroup: null }
      ]
    },
    {
      group: 'Dokumenti',
      items: [
        { id: 'documents', label: 'Dokumenti', icon: 'folder', route: '/student-documents', subGroup: null }
      ]
    },
    {
      group: 'Placanja',
      items: [
        { id: 'my-payments', label: 'Moja placanja', icon: 'payments', route: '/my-payments', subGroup: null }
      ]
    },
    {
      group: 'Status vize',
      items: [
        { id: 'visa-status', label: 'Status vize', icon: 'flight', route: '/visa-status', subGroup: null }
      ]
    },
    {
      group: 'Raspored',
      items: [
        { id: 'timetable', label: 'Raspored', icon: 'calendar_today', route: '/time-table-view-student', subGroup: null }
      ]
    },
    {
      group: 'Pomoc',
      items: [
        { id: 'help', label: 'Pomoc i podr�ka', icon: 'help', route: '/help', subGroup: null }
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
      TEACHER: '/teacher-dashboard',
      STUDENT: '/student-progress'
    };
    return map[role] || '/home';
  }

  /** First allowed sidebar route for SUB_ADMIN; profile when nothing else is granted. */
  getSubAdminDefaultRoute(
    sidebarPermissions: string[] = [],
    sidebarAccessLevels: Record<string, AccessLevel> = {}
  ): string {
    const nav = this.getNavForRole('SUB_ADMIN', sidebarPermissions, [], sidebarAccessLevels, {});
    for (const group of nav) {
      for (const item of group.items) {
        if (item.route) {
          return item.route;
        }
      }
    }
    return '/profile';
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

  // -- Teacher tab permissions (view/edit/full) -------------------------------

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

  /** Whether the user may see finance dashboard data (overview KPIs, payment columns, etc.). */
  canViewFinanceDashboard(
    role: string,
    sidebarPermissions: string[] = [],
    sidebarAccessLevels: Record<string, AccessLevel> = {},
    teacherTabPermissions: string[] = [],
    teacherTabAccessLevels: Record<string, AccessLevel> = {}
  ): boolean {
    const tabId = 'finance-dashboard';
    if (role === 'ADMIN' || role === 'TEACHER_ADMIN') return true;
    if (role === 'SUB_ADMIN') {
      const level = this.getTabAccessLevel(tabId, sidebarAccessLevels, sidebarPermissions);
      return this.canAccessLevel(level || undefined, 'view');
    }
    if (role === 'TEACHER') {
      const level = this.getTabAccessLevel(tabId, teacherTabAccessLevels, teacherTabPermissions);
      return this.canAccessLevel(level || undefined, 'view');
    }
    return false;
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
    return allowedItems.some(item => this.tabAllowsRoute(item.id, item.route, normalizedRoute));
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
      const learningIdx = baseNav.findIndex((g) => g.group === 'Ucenje');
      if (journeyItem && learningIdx >= 0) {
        const learning = baseNav[learningIdx];
        const hasJourney = learning.items.some((i) => i.id === 'journey');
        if (!hasJourney) {
          baseNav[learningIdx] = {
            ...learning,
            items: [...learning.items, { ...journeyItem, label: 'Put' }]
          };
        }
      }
    }

    const assignedAdminGroups: NavGroup[] = this.ADMIN_NAV
      .map((group) => ({
        ...group,
        group: `${group.group} (Dodeljen pristup)`,
        items: group.items
          .filter((item) => allowedIds.has(item.id) && item.id !== 'journey')
          .map((item) =>
            item.id === 'teacher-resources'
              ? { ...item, label: 'Resursi', route: '/teacher/resources' }
              : item
          )
      }))
      .filter((group) => group.items.length > 0);

    return [...baseNav, ...assignedAdminGroups];
  }

  // -- Sub-Admin permissions -------------------------------------------------

  private readonly LEGACY_PERMISSION_ALIASES: Record<string, string> = {
    'krish-dashboard': 'enrollment-overview',
    'enrollment-overdue': 'enrollment-overview',
    'university-apps': 'documents',
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
    return allowedItems.some(item => this.tabAllowsRoute(item.id, item.route, normalizedRoute));
  }

  /** Whether a sidebar tab grants access to a route (primary route, aliases, or v2 child patterns). */
  private tabAllowsRoute(tabId: string, tabRoute: string, normalizedRoute: string): boolean {
    if (this.routeMatches(tabRoute, normalizedRoute)) return true;
    const aliases = [
      ...(this.SUB_ADMIN_ROUTE_ALIASES[tabId] || []),
      ...(this.TEACHER_ROUTE_ALIASES[tabId] || []),
    ];
    if (aliases.some(alias => this.routeMatches(alias, normalizedRoute))) return true;
    const v2Patterns = this.V2_TAB_CHILD_ROUTE_PATTERNS[tabId] || [];
    return v2Patterns.some(rx => rx.test(normalizedRoute));
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
