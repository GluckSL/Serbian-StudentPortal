// src/app/app-routing.module.ts

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent } from './components/login/login.component';
import { SignupComponent } from './components/signup/signup.component';
import { AdminDashboardComponent } from './components/admin-dashboard/admin-dashboard.component';
import { HomeComponent } from './components/home/home.component';
import { AuthGuard } from './guards/auth.guard';
import { RoleGuard } from './guards/role.guard';
import { VisaDocsOnlyGuard } from './guards/visa-docs-only.guard';
import { ProfileComponent } from './components/profile/profile.component';
import { CreateCourseComponent } from './components/courses/course-create.component';

export const routes: Routes = [
  // Default route
  { path: '', redirectTo: 'home', pathMatch: 'full' },

  // Home route
  { path: 'home', loadComponent: () => import('./components/home/home.component').then(m => m.HomeComponent) },

  // Help & Support — accessible without login (and after login)
  { path: 'help', loadComponent: () => import('./components/help/help.component').then(m => m.HelpComponent) },

  // Admin: manage all support tickets
  {
    path: 'admin/support-tickets',
    loadComponent: () => import('./components/help/help-admin.component').then(m => m.HelpAdminComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN'] }
  },

  // Admin: Olly live chat
  {
    path: 'admin/olly-chat',
    loadComponent: () => import('./components/olly-admin/olly-admin.component').then(m => m.OllyAdminComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN', 'SUB_ADMIN'] }
  },

  // Admin: Class Feedback management
  {
    path: 'admin/class-feedback',
    loadComponent: () => import('./components/class-feedback-admin/class-feedback-admin.component').then(m => m.ClassFeedbackAdminComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN', 'SUB_ADMIN'] }
  },

  // Login and Signup routes
  { path: 'login', loadComponent: () => import('./components/login/login.component').then(m => m.LoginComponent) },
  { path: 'register', loadComponent: () => import('./components/register/register.component').then(m => m.RegisterComponent) },
  { path: 'forgot-password', loadComponent: () => import('./components/forgot-password/forgot-password.component').then(m => m.ForgotPasswordComponent) },
  { path: 'signup', loadComponent: () => import('./components/signup/signup.component').then(m => m.SignupComponent) },

  // Public student self-signup wizard — must be before signup/:id to prevent 'apply' matching as an :id param
  { path: 'signup/apply', loadComponent: () => import('./components/public-signup/signup-apply.component').then(m => m.SignupApplyComponent) },

  { path: 'signup/:id', loadComponent: () => import('./components/signup/signup.component').then(m => m.SignupComponent) },

  // Profile route for user profile (standalone)
  { path: 'profile', loadComponent: () => import('./components/profile/profile.component').then(m => m.ProfileComponent) },

  // Teacher dashboard route with RoleGuard to ensure role-based access
  {
    path: 'teacher-dashboard',
    loadChildren: () => import('./components/teacher-dashboard/teacher-dashboard.module')
      .then(m => m.TeacherDashboardModule),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['TEACHER', 'TEACHER_ADMIN'] }
  },

  // Student dashboard — redirect to student-progress
  {
    path: 'student-dashboard',
    redirectTo: 'student-progress',
    pathMatch: 'full'
  },

  // Admin hub — landing page with group cards
  {
    path: 'admin-dashboard',
    loadComponent: () => import('./components/admin-hub/admin-hub.component')
      .then(m => m.AdminHubComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN', 'SUB_ADMIN'] }
  },
  // Student management (moved from /admin-dashboard)
  {
    path: 'admin/students',
    loadComponent: () => import('./components/admin-dashboard/admin-dashboard.component')
      .then(m => m.AdminDashboardComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN', 'SUB_ADMIN'] }
  },
  {
    path: 'admin/students/:studentId',
    loadComponent: () => import('./components/admin-dashboard/admin-student-detail/admin-student-detail.component')
      .then(m => m.AdminStudentDetailComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN'] }
  },

  // User Roles Management
  {
    path: 'user-roles',
    loadComponent: () => import('./components/admin-dashboard/user-roles.component')
      .then(m => m.UserRolesComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN'] }
  },

  {
    path: 'account-audit-log',
    loadComponent: () => import('./components/admin-dashboard/account-audit-log.component')
      .then(m => m.AccountAuditLogComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN', 'SUB_ADMIN'] }
  },


  // ✅ NEW: AI Usage Analytics route
  {
    path: 'admin/ai-usage-analytics',
    loadComponent: () => import('./components/admin-dashboard/ai-usage-analytics/ai-usage-analytics.component')
      .then(m => m.AiUsageAnalyticsComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN'] }
  },

  // Admin module trash management route
  {
    path: 'admin-trash',
    loadComponent: () => import('./components/admin-dashboard/module-trash/module-trash.component')
      .then(m => m.ModuleTrashComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN'] }
  },

  { path: 'teachers', loadComponent: () => import('./components/teachers/teachers.component').then(m => m.TeachersComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },
  {
    path: 'teachers/analytics-overview',
    loadComponent: () => import('./components/teachers/teacher-analytics-overview.component').then(m => m.TeacherAnalyticsOverviewComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN'] }
  },
  {
    path: 'teachers/:id/monthly-hours',
    loadComponent: () => import('./components/teachers/teacher-monthly-hours.component').then(m => m.TeacherMonthlyHoursComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN'] }
  },
  {
    path: 'teachers/:id/analytics',
    loadComponent: () => import('./components/teachers/teacher-analytics.component').then(m => m.TeacherAnalyticsComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN', 'TEACHER'] }
  },
  {
    path: 'my-analytics',
    loadComponent: () => import('./components/teachers/teacher-analytics.component').then(m => m.TeacherAnalyticsComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['TEACHER', 'TEACHER_ADMIN'] }
  },

  { path: 'courses', loadComponent: () => import('./components/courses/courses.component').then(m => m.CoursesComponent), canActivate: [AuthGuard] },
  { path: 'update-course/:id', loadComponent: () => import('./components/courses/course-create.component').then(m => m.CreateCourseComponent), canActivate: [AuthGuard] },
  { path: 'create-course', loadComponent: () => import('./components/courses/course-create.component').then(m => m.CreateCourseComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'subscriptions', loadComponent: () => import('./components/subscriptions/subscriptions.component').then(m => m.SubscriptionsComponent), canActivate: [AuthGuard] },
  { path: 'ai-conversations', loadComponent: () => import('./components/ai-conversations/ai-conversations.component').then(m => m.AiConversationsComponent), canActivate: [AuthGuard] },

  { path: 'time-table', loadComponent: () => import('./components/time-table/time-table.component').then(m => m.TimeTableComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },

  { path: 'time-table/:id', loadComponent: () => import('./components/time-table/time-table.component').then(m => m.TimeTableComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },

  {
    path: 'time-table-view-admin',
    loadComponent: () => import('./components/time-table/time-table-view.component')
                        .then(m => m.TimeTableViewComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN'] }
  },
  {
    path: 'time-table-view-student',
    loadComponent: () => import('./components/time-table/time-table-view.component')
                        .then(m => m.TimeTableViewComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: 'STUDENT' }
  },

  { path: 'time-table-view-teacher',
    loadComponent: () => import('./components/time-table/time-table-view.component')
                        .then(m => m.TimeTableViewComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['TEACHER', 'TEACHER_ADMIN'] }
  },

  { path: 'feedback', loadComponent: () => import('./components/feedback/feedback-form.component').then(m => m.FeedbackFormComponent) , canActivate: [AuthGuard, RoleGuard], data: { role: 'STUDENT' } },

  { path: 'feedback-list', loadComponent: () => import('./components/feedback/feedback.component').then(m => m.FeedbackListComponent) , canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },

  // Teacher Assignments Route
  { path: 'teacher/assignments', loadComponent: () => import('./components/teacher-assignments/teacher-assignments-page.component').then(m => m.TeacherAssignmentsPageComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['TEACHER', 'TEACHER_ADMIN'] } },

  { path: 'teacher/my-classes', redirectTo: '/teacher-dashboard/my-classes', pathMatch: 'full' },

  // Gluck Room Routes
  { path: 'gluck-room', loadComponent: () => import('./components/gluck-room-list/gluck-room-list.component').then(m => m.GluckRoomListComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['TEACHER', 'ADMIN', 'SUB_ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'gluck-room/create', loadComponent: () => import('./components/gluck-room-create/gluck-room-create.component').then(m => m.GluckRoomCreateComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['TEACHER', 'ADMIN', 'SUB_ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'gluck-room/:id/edit', loadComponent: () => import('./components/gluck-room-create/gluck-room-create.component').then(m => m.GluckRoomCreateComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['TEACHER', 'ADMIN', 'SUB_ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'gluck-room/:id', loadComponent: () => import('./components/gluck-room/gluck-room.component').then(m => m.GluckRoomRoomComponent), canActivate: [AuthGuard] },
  { path: 'gluck-room/recording/:recordingId', loadComponent: () => import('./components/gluck-room-recording/gluck-room-recording.component').then(m => m.GluckRoomRecordingComponent), canActivate: [AuthGuard] },
  { path: 'student/gluck-room', loadComponent: () => import('./components/gluck-room-list/gluck-room-list.component').then(m => m.GluckRoomListComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['STUDENT'] } },

  // Zoom Meetings Routes (New System)
  { path: 'teacher/meetings', loadComponent: () => import('./components/meeting-link/meetings-list.component').then(m => m.MeetingsListComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['TEACHER', 'ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'teacher/meetings/create', loadComponent: () => import('./components/meeting-link/create-zoom-meeting.component').then(m => m.CreateZoomMeetingComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['TEACHER', 'ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'teacher/meetings/bulk-journey-create', loadComponent: () => import('./components/meeting-link/bulk-journey-meeting.component').then(m => m.BulkJourneyMeetingComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['TEACHER', 'ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'teacher/meetings/:id', loadComponent: () => import('./components/meeting-link/meeting-details.component').then(m => m.MeetingDetailsComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['TEACHER', 'ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'teacher/meetings/:id/edit', loadComponent: () => import('./components/meeting-link/edit-meeting.component').then(m => m.EditMeetingComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['TEACHER', 'ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'teacher/meetings/:id/attendance', loadComponent: () => import('./components/meeting-link/meeting-attendance.component').then(m => m.MeetingAttendanceComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['TEACHER', 'ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'teacher/meetings/:id/attendance/review', loadComponent: () => import('./components/meeting-link/attendance-review.component').then(m => m.AttendanceReviewComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['TEACHER', 'ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'teacher/meetings/:id/engagement', loadComponent: () => import('./components/meeting-link/meeting-engagement.component').then(m => m.MeetingEngagementComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['TEACHER', 'ADMIN', 'TEACHER_ADMIN'] } },

  // Student course hub (classes, exercises, modules)
  {
    path: 'student/my-course',
    loadComponent: () => import('./components/my-course/my-course.component').then(m => m.MyCourseComponent),
    canActivate: [AuthGuard, RoleGuard, VisaDocsOnlyGuard],
    data: { role: 'STUDENT' }
  },

  // Common typos / old links → same hub (avoids ** → home and stale UI confusion)
  { path: 'student/my_course', redirectTo: '/student/my-course', pathMatch: 'full' },
  { path: 'student/mycourse', redirectTo: '/student/my-course', pathMatch: 'full' },

  // Student Zoom Meetings & recordings — consolidated into My Course
  { path: 'student/meetings', redirectTo: '/student/my-course', pathMatch: 'full' },

  // Admin Zoom Reports
  { path: 'admin/zoom-reports', loadComponent: () => import('./components/admin-dashboard/zoom-reports.component').then(m => m.ZoomReportsComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN', 'TEACHER', 'SUB_ADMIN'] } },
  { path: 'admin/attendance-dashboard', loadComponent: () => import('./components/admin-dashboard/attendance-dashboard.component').then(m => m.AttendanceDashboardComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN', 'TEACHER', 'SUB_ADMIN'] } },
  { path: 'admin/portal-join-alert', loadComponent: () => import('./components/admin-dashboard/portal-join-alert.component').then(m => m.PortalJoinAlertComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },


  // Class Recordings — Teacher/Admin manage
  { path: 'class-recordings', loadComponent: () => import('./components/class-recordings/manage-recordings/manage-recordings.component').then(m => m.ManageRecordingsComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN', 'TEACHER', 'SUB_ADMIN'] } },
  { path: 'class-recordings/approval-requests', loadComponent: () => import('./components/class-recordings/recording-access-approval/recording-access-approval-page.component').then(m => m.RecordingAccessApprovalPageComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN', 'TEACHER', 'SUB_ADMIN'] } },
  { path: 'class-recordings/self-pace', loadComponent: () => import('./components/class-recordings/recording-cross-batch-access/recording-cross-batch-access-page.component').then(m => m.RecordingCrossBatchAccessPageComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN', 'TEACHER', 'SUB_ADMIN'] } },
  { path: 'class-recordings/access-recording', redirectTo: '/class-recordings/self-pace', pathMatch: 'full' },

  // Class Recordings — Student view (hub)
  { path: 'student/class-recordings', redirectTo: '/student/my-course', pathMatch: 'full' },

  { path: 'course-materials', loadComponent: () => import('./components/course-material/course-material-upload.component').then(m => m.UploadCourseMaterialComponent), canActivate: [AuthGuard, RoleGuard], data: {role: ['ADMIN', 'TEACHER_ADMIN']} },

  { path: 'view-course-materials', loadComponent: () => import('./components/course-material/course-materials.component').then(m => m.CourseMaterialsComponent), canActivate: [AuthGuard] },

  { path: 'admin/teacher-resources', loadComponent: () => import('./components/admin-dashboard/teacher-resources-admin.component').then(m => m.TeacherResourcesAdminComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'teacher/resources', loadComponent: () => import('./components/teacher-dashboard/teacher-resources.component').then(m => m.TeacherResourcesComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },

  // New AI Tutoring System Routes
  // Module creation/editing routes (Teachers and Admins)
  { path: 'module-creation-choice', loadComponent: () => import('./components/teacher-dashboard/module-creation-choice.component').then(m => m.ModuleCreationChoiceComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['TEACHER', 'ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'create-module', loadComponent: () => import('./components/teacher-dashboard/module-form.component').then(m => m.ModuleFormComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['TEACHER', 'ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'create-module-ai', loadComponent: () => import('./components/teacher-dashboard/ai-module-creator.component').then(m => m.AiModuleCreatorComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['TEACHER', 'ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'create-roleplay-module', loadComponent: () => import('./components/teacher-dashboard/roleplay-module-form.component').then(m => m.RoleplayModuleFormComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['TEACHER', 'ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'edit-module/:id', loadComponent: () => import('./components/teacher-dashboard/roleplay-module-form.component').then(m => m.RoleplayModuleFormComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['TEACHER', 'ADMIN', 'TEACHER_ADMIN'] } },

  { path: 'student-progress', loadComponent: () => import('./components/student-progress/student-progress.component').then(m => m.StudentProgressComponent), canActivate: [AuthGuard, RoleGuard], data: { role: 'STUDENT' } },

  /* Serbia: removed student-payments */

  { path: 'performance-history', loadComponent: () => import('./components/student-dashboard/performance-history.component').then(m => m.PerformanceHistoryComponent), canActivate: [AuthGuard, RoleGuard], data: { role: 'STUDENT' } },

  // Student Documents route
  /* Serbia: removed student-documents */
  { path: 'student/announcements', loadComponent: () => import('./components/student-announcements/student-announcements.component').then(m => m.StudentAnnouncementsComponent), canActivate: [AuthGuard, RoleGuard], data: { role: 'STUDENT' } },
  /* Serbia: removed student/job-openings */
  /* Serbia: removed student/job-openings/:id */

  // Admin Document Verification route
  /* Serbia: removed admin/document-verification */
  /* Serbia: removed admin/document-verification/student/:studentId */
  /* Serbia: removed admin/university-applications */

  // Google Sheet Sync route
  /* Serbia: removed admin/google-sheet-sync */

  // Admin Agreement Templates & Student Workspaces
  { path: 'admin/agreements/templates', loadComponent: () => import('./components/admin-dashboard/agreements/agreement-templates.component').then(m => m.AgreementTemplatesComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'admin/agreements/student/:studentId', loadComponent: () => import('./components/admin-dashboard/agreements/student-agreements.component').then(m => m.StudentAgreementsComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },

  // Admin Visa Tracking route
  /* Serbia: removed admin/visa-tracking */

  // Admin Batch Leaderboard
  { path: 'admin/leaderboard', loadComponent: () => import('./components/admin-dashboard/admin-leaderboard/admin-leaderboard.component').then(m => m.AdminLeaderboardComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN', 'TEACHER'] } },

  // Student Visa Status page
  /* Serbia: removed visa-status */

  // Legacy admin payment tabs hidden — use Payment Hub (New) instead
  // { path: 'admin/payments', loadComponent: () => import('./components/admin-dashboard/admin-payments/admin-payments.component').then(m => m.AdminPaymentsComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },
  // { path: 'admin/invoices', loadComponent: () => import('./components/admin-dashboard/invoice-management/invoice-management.component').then(m => m.InvoiceManagementComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },
  // { path: 'admin/payment-approvals', loadComponent: () => import('./components/admin-dashboard/payment-approvals/payment-approvals.component').then(m => m.PaymentApprovalsComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },

  // Payment Hub / finance routes removed for Serbia
  /* Serbia: removed admin/payment-hub */
  /* Serbia: removed admin/payment-notifications */
  /* Serbia: removed admin/finance-dashboard */
  /* Serbia: removed admin/finance-dashboard/batches */
  /* Serbia: removed admin/finance-dashboard/language-payment */
  /* Serbia: removed admin/finance-dashboard/students */
  /* Serbia: removed admin/finance-dashboard/silver-payment */
  /* Serbia: removed admin/finance-dashboard/health-checkup */
  /* Serbia: removed admin/payment-hub/insights/batches */
  /* Serbia: removed admin/payment-hub/insights/batches/:batch/students */
  /* Serbia: removed admin/payment-hub/insights/revenue */
  /* Serbia: removed admin/payment-hub/insights/journey */
  /* Serbia: removed admin/payment-hub/settings */
  /* Serbia: removed admin/payment-hub/student/:studentId */
  /* Serbia: removed admin/payment-request */
  /* Serbia: removed admin/payment-request/student/:studentId */
  /* Serbia: removed my-payments */

  // Admin Student Progress Overview
  { path: 'admin/student-progress', loadComponent: () => import('./components/admin-dashboard/admin-progress/admin-progress.component').then(m => m.AdminProgressComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'admin/performance', loadComponent: () => import('./components/admin-dashboard/admin-performance/admin-performance.component').then(m => m.AdminPerformanceComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'admin/performance/student/:studentId', loadComponent: () => import('./components/admin-dashboard/admin-performance/admin-performance.component').then(m => m.AdminPerformanceComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },
  /* Serbia: removed admin/language-tracking */
  /* Serbia: removed admin/language-tracking/student/:studentId */
  /* Serbia: removed admin/language-tracking/crucial-students */
  { path: 'admin/engagement-overview', loadComponent: () => import('./pages/engagement-overview/engagement-overview.component').then(m => m.EngagementOverviewComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },

  // Enrollment Overview — removed for Serbia
  /* Serbia: removed admin/enrollment-overview */
  /* Serbia: removed admin/krish-dashboard */
  /* Serbia: removed admin/enrollment-overdue */

  { path: 'admin/announcements', loadComponent: () => import('./components/admin-dashboard/admin-announcements.component').then(m => m.AdminAnnouncementsComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN', 'TEACHER'] } },
  /* Serbia: removed admin/job-openings */

  // Test Accounts management
  { path: 'admin/test-accounts', loadComponent: () => import('./components/admin-dashboard/test-accounts/test-accounts.component').then(m => m.TestAccountsComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN'] } },

  // Correction Panel
  {
    path: 'admin/correction/review/:studentId/:exerciseId/:attemptId',
    loadComponent: () => import('./components/admin-dashboard/correction/correction-review.component').then(m => m.CorrectionReviewComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN'] }
  },
  {
    path: 'admin/correction',
    loadComponent: () => import('./components/admin-dashboard/correction/correction.component').then(m => m.CorrectionComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN'] }
  },

  // Journey Management
  { path: 'admin/journey/go/:studentId', loadComponent: () => import('./components/admin-dashboard/go-student-journey-detail/go-student-journey-detail.component').then(m => m.GoStudentJourneyDetailComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'admin/journey/all-students', loadComponent: () => import('./components/admin-dashboard/journey-all-students/journey-all-students.component').then(m => m.JourneyAllStudentsComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'admin/journey/weekly-students', loadComponent: () => import('./components/admin-dashboard/journey-weekly-students/journey-weekly-students.component').then(m => m.JourneyWeeklyStudentsComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },
  { path: 'admin/journey', loadComponent: () => import('./components/admin-dashboard/journey-management/journey-management.component').then(m => m.JourneyManagementComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN'] } },
  /* Serbia: removed admin/go-students */

  { path: 'ai-tutor-chat', loadComponent: () => import('./components/ai-tutor-chat/ai-tutor-chat.component').then(m => m.AiTutorChatComponent), canActivate: [AuthGuard, RoleGuard, VisaDocsOnlyGuard], data: { role: ['STUDENT', 'TEACHER', 'ADMIN', 'TEACHER_ADMIN'] } },

  // Audio Test Route (for students and teachers to test microphone and speakers)
  { path: 'audio-test', loadComponent: () => import('./components/audio-test/audio-test.component').then(m => m.AudioTestComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['STUDENT', 'TEACHER', 'TEACHER_ADMIN'] } },

  {
    path: 'portal-analytics/daily-logs',
    loadComponent: () =>
      import('./pages/portal-analytics/portal-analytics-daily-logs-page.component').then(
        (m) => m.PortalAnalyticsDailyLogsPageComponent
      ),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN'] }
  },
  {
    path: 'portal-analytics',
    loadComponent: () =>
      import('./pages/portal-analytics/portal-analytics.component').then((m) => m.PortalAnalyticsComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN'] }
  },
  // ── DG Bot (Digital Guide) ───────────────────────────────────────────────
  {
    path: 'dg-bot',
    loadComponent: () => import('./dg-bot/dg-bot-hub/dg-bot-hub.component').then((m) => m.DgBotHubComponent),
    canActivate: [AuthGuard, RoleGuard, VisaDocsOnlyGuard],
    data: { role: 'STUDENT' },
  },
  {
    path: 'dg-bot/:moduleId/play',
    loadComponent: () =>
      import('./dg-bot/dg-bot-player/dg-bot-player.component').then((m) => m.DgBotPlayerComponent),
    canActivate: [AuthGuard],
  },
  {
    path: 'admin/dg-modules/new',
    loadComponent: () =>
      import('./dg-bot/dg-admin-module-form/dg-admin-module-form.component').then(
        (m) => m.DgAdminModuleFormComponent,
      ),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'], dgFormMode: 'create' },
  },
  {
    path: 'admin/dg-modules/:moduleId/analytics',
    loadComponent: () =>
      import('./dg-bot/dg-admin-module-analytics/dg-admin-module-analytics.component').then(
        (m) => m.DgAdminModuleAnalyticsComponent,
      ),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'] },
  },
  {
    path: 'admin/dg-modules/:id/beginner-mode',
    loadComponent: () =>
      import('./dg-bot/dg-admin-beginner-mode/dg-admin-beginner-mode.component').then(
        (m) => m.DgAdminBeginnerModeComponent,
      ),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'] },
  },
  {
    path: 'admin/dg-modules/:id/edit',
    loadComponent: () =>
      import('./dg-bot/dg-admin-module-form/dg-admin-module-form.component').then(
        (m) => m.DgAdminModuleFormComponent,
      ),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'], dgFormMode: 'edit' },
  },
  {
    path: 'admin/dg-modules',
    loadComponent: () =>
      import('./dg-bot/dg-admin-modules/dg-admin-modules.component').then((m) => m.DgAdminModulesComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'], moduleVersion: 'v1' },
  },
  {
    path: 'admin/dg-modules-v2',
    loadComponent: () =>
      import('./dg-bot/dg-admin-modules/dg-admin-modules.component').then((m) => m.DgAdminModulesComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'], moduleVersion: 'v2' },
  },

  // ── Sprechen Exam (Goethe A1 Speaking Bot) ───────────────────────────────
  {
    path: 'sprechen-exam',
    loadComponent: () =>
      import('./sprechen-exam/sprechen-exam-hub/sprechen-exam-hub.component').then(
        (m) => m.SprechenExamHubComponent,
      ),
    canActivate: [AuthGuard, RoleGuard, VisaDocsOnlyGuard],
    data: { role: 'STUDENT' },
  },
  {
    path: 'sprechen-exam/:moduleId/play',
    loadComponent: () =>
      import('./sprechen-exam/sprechen-exam-player/sprechen-exam-player.component').then(
        (m) => m.SprechenExamPlayerComponent,
      ),
    canActivate: [AuthGuard],
  },
  {
    path: 'admin/sprechen-exam',
    loadComponent: () =>
      import('./sprechen-exam/sprechen-admin-modules/sprechen-admin-modules.component').then(
        (m) => m.SprechenAdminModulesComponent,
      ),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'] },
  },
  {
    path: 'admin/sprechen-exam/new',
    loadComponent: () =>
      import('./sprechen-exam/sprechen-admin-module-form/sprechen-admin-module-form.component').then(
        (m) => m.SprechenAdminModuleFormComponent,
      ),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'], sprechenFormMode: 'create' },
  },
  {
    path: 'admin/sprechen-exam/new-a2',
    loadComponent: () =>
      import('./sprechen-exam/sprechen-a2-admin-module-form/sprechen-a2-admin-module-form.component').then(
        (m) => m.SprechenA2AdminModuleFormComponent,
      ),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'], sprechenFormMode: 'create-a2' },
  },
  {
    path: 'admin/sprechen-exam/:id/edit',
    loadComponent: () =>
      import('./sprechen-exam/sprechen-admin-module-form/sprechen-admin-module-form.component').then(
        (m) => m.SprechenAdminModuleFormComponent,
      ),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'], sprechenFormMode: 'edit' },
  },
  {
    path: 'admin/sprechen-exam/:id/edit-a2',
    loadComponent: () =>
      import('./sprechen-exam/sprechen-a2-admin-module-form/sprechen-a2-admin-module-form.component').then(
        (m) => m.SprechenA2AdminModuleFormComponent,
      ),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'], sprechenFormMode: 'edit-a2' },
  },
  {
    path: 'admin/sprechen-exam/:moduleId/sessions',
    loadComponent: () =>
      import('./sprechen-exam/sprechen-session-review/sprechen-session-review.component').then(
        (m) => m.SprechenSessionReviewComponent,
      ),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'] },
  },

  // ── Digital Exercises (new feature) ──────────────────────────────────────
  // Student & all roles: browse and play exercises
  {
    path: 'digital-exercises',
    loadComponent: () => import('./components/digital-exercises/digital-exercises.component').then(m => m.DigitalExercisesComponent),
    canActivate: [AuthGuard, VisaDocsOnlyGuard]
  },
  {
    path: 'digital-exercises/analytics',
    loadComponent: () =>
      import('./components/student-digital-exercises-analytics/student-digital-exercises-analytics.component').then(
        (m) => m.StudentDigitalExercisesAnalyticsComponent
      ),
    canActivate: [AuthGuard, VisaDocsOnlyGuard]
  },
  {
    path: 'digital-exercises/:idPart1/:idPart2/play',
    loadComponent: () => import('./components/digital-exercise-player/digital-exercise-player.component').then(m => m.DigitalExercisePlayerComponent),
    canActivate: [AuthGuard, VisaDocsOnlyGuard]
  },
  {
    path: 'digital-exercises/:id/play/freemode',
    loadComponent: () => import('./components/free-mode-exercise-renderer/free-mode-exercise-renderer.component').then(m => m.FreeModeExerciseRendererComponent),
    canActivate: [AuthGuard, VisaDocsOnlyGuard]
  },
  {
    path: 'digital-exercises/:id/play',
    loadComponent: () => import('./components/digital-exercise-player/digital-exercise-player.component').then(m => m.DigitalExercisePlayerComponent),
    canActivate: [AuthGuard, VisaDocsOnlyGuard]
  },
  {
    path: 'digital-exercises/:id/review',
    loadComponent: () => import('./components/digital-exercise-review/digital-exercise-review.component').then(m => m.DigitalExerciseReviewComponent),
    canActivate: [AuthGuard, VisaDocsOnlyGuard]
  },
  // Admin/Teacher: manage exercises
  {
    path: 'admin/digital-exercises',
    loadComponent: () => import('./components/admin-dashboard/digital-exercise-management/digital-exercise-management.component').then(m => m.DigitalExerciseManagementComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'] }
  },
  // Admin/Teacher: Online Exercises 2.0 — batch-specific exercises for newer batches
  {
    path: 'admin/digital-exercises-v2',
    loadComponent: () => import('./components/admin-dashboard/digital-exercise-management/digital-exercise-management.component').then(m => m.DigitalExerciseManagementComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'], exerciseVersion: 'v2' }
  },
  // Admin/Teacher: create exercise via free mode builder
  {
    path: 'admin/digital-exercises/create-freemode',
    loadComponent: () => import('./components/free-mode-exercise-builder/free-mode-exercise-builder.component').then(m => m.FreeModeExerciseBuilderComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'] }
  },
  // Admin/Teacher: create exercise (builder)
  {
    path: 'admin/digital-exercises/create',
    loadComponent: () => import('./components/digital-exercise-builder/digital-exercise-builder.component').then(m => m.DigitalExerciseBuilderComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'] }
  },
  // Admin/Teacher: create video pronunciation exercise (wizard)
  {
    path: 'admin/digital-exercises/create-video',
    loadComponent: () => import('./components/video-exercise-wizard/video-exercise-wizard.component').then(m => m.VideoExerciseWizardComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'] }
  },
  // Admin/Teacher: edit exercise
  {
    path: 'admin/digital-exercises/:id/edit',
    loadComponent: () => import('./components/digital-exercise-builder/digital-exercise-builder.component').then(m => m.DigitalExerciseBuilderComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'] }
  },
  // Admin/Teacher: edit free mode exercise
  {
    path: 'admin/digital-exercises/:id/edit-freemode',
    loadComponent: () => import('./components/free-mode-exercise-builder/free-mode-exercise-builder.component').then(m => m.FreeModeExerciseBuilderComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'] }
  },
  // Worksheet PDF / AI Stage generator
  {
    path: 'admin/digital-exercises/generate-ai',
    loadComponent: () => import('./components/pdf-exercise-generator/pdf-exercise-generator.component').then(m => m.PdfExerciseGeneratorComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'] }
  },
  // Admin/Teacher: Exercise completion analytics (details page)
  {
    path: 'admin/digital-exercises/:id/completions',
    loadComponent: () => import('./components/admin-dashboard/exercise-completion-details/exercise-completion-details.component').then(m => m.ExerciseCompletionDetailsComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'] }
  },
  {
    path: 'admin/digital-exercises/:id/attempt/:attemptId',
    loadComponent: () => import('./components/admin-dashboard/exercise-attempt-detail/exercise-attempt-detail.component').then(m => m.ExerciseAttemptDetailComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'] }
  },
  // Admin/Teacher: Audio + PDF listening worksheet import
  {
    path: 'admin/digital-exercises/generate-listening-manual',
    loadComponent: () => import('./components/listening-worksheet-generator/listening-worksheet-generator.component').then(m => m.ListeningWorksheetGeneratorComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'] }
  },

  // Class Recordings — Teacher/Admin manage
  { path: 'class-recordings', loadComponent: () => import('./components/class-recordings/manage-recordings/manage-recordings.component').then(m => m.ManageRecordingsComponent), canActivate: [AuthGuard, RoleGuard], data: { role: ['ADMIN', 'TEACHER_ADMIN', 'TEACHER'] } },

  // Class Recordings — Student view
  { path: 'student/class-recordings', loadComponent: () => import('./components/class-recordings/student-recordings/student-recordings.component').then(m => m.StudentRecordingsComponent), canActivate: [AuthGuard, RoleGuard, VisaDocsOnlyGuard], data: { role: 'STUDENT' } },

  // ── GlückArena — Student routes ──────────────────────────────────────────
  {
    path: 'glueck-arena',
    loadComponent: () => import('./features/glueck-arena/components/arena-layout/arena-layout.component').then(m => m.ArenaLayoutComponent),
    canActivate: [AuthGuard, VisaDocsOnlyGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./features/glueck-arena/components/game-catalog/game-catalog.component').then(m => m.GameCatalogComponent),
      },
      {
        path: 'leaderboard',
        loadComponent: () => import('./features/glueck-arena/components/game-leaderboard/game-leaderboard.component').then(m => m.GameLeaderboardComponent),
      },
      {
        path: 'battlefield',
        loadComponent: () => import('./features/glueck-arena/components/battlefield-hub/battlefield-hub.component').then(m => m.BattlefieldHubComponent),
      },
      {
        path: 'battlefield/leaderboard',
        loadComponent: () => import('./features/glueck-arena/components/battlefield-leaderboard/battlefield-leaderboard.component').then(m => m.BattlefieldLeaderboardComponent),
      },
      {
        path: 'battlefield/room/:code',
        loadComponent: () => import('./features/glueck-arena/components/battlefield-room/battlefield-room.component').then(m => m.BattlefieldRoomComponent),
      },
      {
        path: 'multiplayer',
        loadComponent: () => import('./features/glueck-arena/components/multiplayer-lobby/multiplayer-lobby.component').then(m => m.MultiplayerLobbyComponent),
      },
      {
        path: 'multiplayer/battle',
        loadComponent: () => import('./features/glueck-arena/components/multiplayer-battle/multiplayer-battle.component').then(m => m.MultiplayerBattleComponent),
      },
      {
        path: 'multiplayer/spectate',
        loadComponent: () => import('./features/glueck-arena/components/spectator-watch/spectator-watch.component').then(m => m.SpectatorWatchComponent),
      },
      {
        path: ':id/play',
        loadComponent: () => import('./features/glueck-arena/components/game-play-shell/game-play-shell.component').then(m => m.GamePlayShellComponent),
      },
      {
        path: ':id',
        loadComponent: () => import('./features/glueck-arena/components/game-detail/game-detail.component').then(m => m.GameDetailComponent),
      },
    ],
  },
  {
    path: 'admin/glueck-arena/command-center',
    loadComponent: () => import('./features/glueck-arena/components/admin/admin-super-dashboard/admin-super-dashboard.component').then(m => m.AdminSuperDashboardComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN'] }
  },
  {
    path: 'admin/glueck-arena/tournaments',
    loadComponent: () => import('./features/glueck-arena/components/admin/admin-tournament-manager/admin-tournament-manager.component').then(m => m.AdminTournamentManagerComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN', 'TEACHER'] }
  },
  {
    path: 'admin/glueck-arena/battlefield/team-battles/standings',
    loadComponent: () => import('./features/glueck-arena/components/admin-team-battle-standings/admin-team-battle-standings.component').then(m => m.TeamBattleStandingsComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN', 'TEACHER'] }
  },
  {
    path: 'admin/glueck-arena/battlefield/team-battles',
    loadComponent: () => import('./features/glueck-arena/components/admin-team-battle/admin-team-battle.component').then(m => m.AdminTeamBattleComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN', 'TEACHER'] }
  },
  // ── GlückArena — Admin routes ─────────────────────────────────────────────
  {
    path: 'admin/glueck-arena',
    loadComponent: () => import('./features/glueck-arena/components/admin/game-set-list/game-set-list.component').then(m => m.GameSetListComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN', 'SUB_ADMIN'] }
  },
  {
    path: 'admin/glueck-arena/create',
    loadComponent: () => import('./features/glueck-arena/components/admin/game-set-editor/game-set-editor.component').then(m => m.GameSetEditorComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN', 'SUB_ADMIN'] }
  },
  {
    path: 'admin/glueck-arena/:id/edit',
    loadComponent: () => import('./features/glueck-arena/components/admin/game-set-editor/game-set-editor.component').then(m => m.GameSetEditorComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN', 'SUB_ADMIN'] }
  },
  {
    path: 'admin/glueck-arena/:id/play',
    loadComponent: () => import('./features/glueck-arena/components/game-play-shell/game-play-shell.component').then(m => m.GamePlayShellComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER', 'TEACHER_ADMIN', 'SUB_ADMIN'], arenaPreview: true }
  },
  {
    path: 'admin/glueck-arena/analytics',
    loadComponent: () => import('./features/glueck-arena/components/admin/admin-analytics-dashboard/admin-analytics-dashboard.component').then(m => m.AdminAnalyticsDashboardComponent),
    canActivate: [AuthGuard, RoleGuard],
    data: { role: ['ADMIN', 'TEACHER_ADMIN'] }
  },
  // Zoom-recorded class session player
  // Accessible by any authenticated user; the backend enforces enrollment checks.
  {
    path: 'class-recording/:meetingLinkId',
    loadComponent: () =>
      import('./components/class-recordings/zoom-recording-player/zoom-recording-player.component')
        .then(m => m.ZoomRecordingPlayerComponent),
    canActivate: [AuthGuard, VisaDocsOnlyGuard],
  },

  // Wildcard route to handle invalid paths
  { path: '**', redirectTo: 'home' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
