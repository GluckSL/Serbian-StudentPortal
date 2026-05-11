import { Injectable } from '@angular/core';
import Shepherd from 'shepherd.js';

@Injectable({ providedIn: 'root' })
export class TourService {
  private tour: any = null;

  hasCompletedTour(role: string = 'STUDENT'): boolean {
    return localStorage.getItem('gluck_tour_' + role.toLowerCase()) === 'true';
  }

  markTourCompleted(role: string = 'STUDENT'): void {
    localStorage.setItem('gluck_tour_' + role.toLowerCase(), 'true');
  }

  resetTour(role: string = 'STUDENT'): void {
    localStorage.removeItem('gluck_tour_' + role.toLowerCase());
  }

  private get isMobile(): boolean {
    return window.innerWidth <= 768;
  }

  private openSidebarIfMobile(): void {
    if (this.isMobile) {
      const btn = document.querySelector('.mobile-menu-btn') as HTMLElement;
      const sidebar = document.querySelector('app-sidebar');
      if (btn && sidebar && !sidebar.classList.contains('open')) {
        btn.click();
      }
    }
  }

  private closeSidebarIfMobile(): void {
    if (this.isMobile) {
      const overlay = document.querySelector('.sidebar-overlay') as HTMLElement;
      if (overlay) overlay.click();
    }
  }

  private createTour(): any {
    if (this.tour) this.tour.cancel();
    this.tour = new Shepherd.Tour({
      useModalOverlay: true,
      defaultStepOptions: {
        scrollTo: true,
        cancelIcon: { enabled: true },
        classes: 'gluck-tour-step',
        modalOverlayOpeningPadding: 8,
        modalOverlayOpeningRadius: 12
      }
    });
    return this.tour;
  }

  private navBtn(back: boolean = true): any[] {
    const btns: any[] = [];
    if (back) btns.push({ text: '← Back', action: () => this.tour.back(), classes: 'shepherd-button-secondary' });
    btns.push({ text: 'Next →', action: () => this.tour.next() });
    return btns;
  }

  private sidebarStep(id: string, element: string, title: string, icon: string, desc: string, back = true): any {
    const self = this;
    return {
      id,
      attachTo: this.isMobile ? undefined : { element, on: 'right' as const },
      text: `<h3 style="margin:0 0 6px;font-size:14px;color:#011f4b;">${icon} ${title}</h3><p style="margin:0;font-size:13px;color:#64748b;">${desc}</p>`,
      buttons: this.navBtn(back),
      beforeShowPromise: function() {
        return new Promise<void>((resolve) => {
          if (self.isMobile) {
            self.openSidebarIfMobile();
            setTimeout(resolve, 350);
          } else { resolve(); }
        });
      }
    };
  }

  private centeredStep(id: string, title: string, icon: string, desc: string, buttons: any[]): any {
    return { id, text: `
      <div style="text-align:center;padding:8px 0;">
        <div style="font-size:32px;margin-bottom:8px;">${icon}</div>
        <h3 style="margin:0 0 8px;font-size:16px;color:#011f4b;">${title}</h3>
        <p style="margin:0;font-size:13px;color:#64748b;">${desc}</p>
      </div>`, buttons };
  }

  startStudentTour(): void {
    const t = this.createTour();
    const self = this;

    t.addStep(this.centeredStep('welcome', 'Welcome to Glück Global!', '👋', 'Let us give you a quick tour of your student portal.', [
      { text: 'Skip Tour', action: () => this.completeTour('STUDENT'), classes: 'shepherd-button-secondary' },
      { text: 'Start Tour →', action: () => t.next() }
    ]));

    t.addStep(this.sidebarStep('sidebar', '.sidebar .nav-body', 'Navigation Menu', '📌', 'This is your main menu. Use it to navigate between all sections of the portal.', false));
    t.addStep(this.sidebarStep('dashboard', '.nav-item[href="/student-progress"]', 'Dashboard', '🏠', 'Your dashboard shows your overall progress — language levels, attendance, AI bot usage, payments, and visa status at a glance.'));
    t.addStep(this.sidebarStep('my-course', '.nav-item[href="/student/my-course"]', 'My Course', '📖', 'Access your Zoom classes, class recordings, digital exercises, and AI learning modules — all in one place.'));
    t.addStep(this.sidebarStep('documents', '.nav-item[href="/student-documents"]', 'Documents', '📁', 'Upload and manage your required documents here. The admin team will verify them for your visa process.'));
    t.addStep(this.sidebarStep('payments', '.nav-item[href="/my-payments"]', 'My Payments', '💳', 'View payment requests from the team, upload proof, and track what\'s been paid and what\'s pending.'));
    t.addStep(this.sidebarStep('visa', '.nav-item[href="/visa-status"]', 'Visa Status', '✈️', 'Track your visa application progress step by step. Stay updated on your application status.'));
    t.addStep(this.sidebarStep('profile', '.sidebar-footer .profile-link', 'Your Profile', '👤', 'View and update your profile information, including your photo and contact details.'));

    t.addStep({
      ...this.centeredStep('finish', "You're all set!", '🎉', 'Explore the portal and start your learning journey. If you need help, contact your teacher or the admin team.', [
        { text: 'Finish Tour ✓', action: () => this.completeTour('STUDENT') }
      ]),
      beforeShowPromise: () => new Promise<void>((resolve) => { self.closeSidebarIfMobile(); setTimeout(resolve, 350); })
    });

    t.start();
  }

  startTeacherTour(): void {
    const t = this.createTour();
    const self = this;

    t.addStep(this.centeredStep('welcome', 'Welcome, Teacher!', '👋', "Here's a quick tour of your teaching portal.", [
      { text: 'Skip Tour', action: () => this.completeTour('TEACHER'), classes: 'shepherd-button-secondary' },
      { text: 'Start Tour →', action: () => t.next() }
    ]));

    t.addStep(this.sidebarStep('sidebar', '.sidebar .nav-body', 'Navigation Menu', '📌', 'Your main menu to access all teaching tools and reports.', false));
    t.addStep(this.sidebarStep('students', '.nav-item[href="/teacher-dashboard"]', 'Students', '👥', 'View and manage your assigned students. Track their progress, update details, and monitor performance.'));
    t.addStep(this.sidebarStep('modules', '.nav-item[href="/learning-modules"]', 'Learning Modules', '🤖', 'Create and manage AI-powered learning modules and role-play scenarios for your students.'));
    t.addStep(this.sidebarStep('exercises', '.nav-item[href="/admin/digital-exercises"]', 'Online Exercises', '🏋️', 'Build and manage digital exercises — MCQ, fill-in-the-blank, matching, listening, and more.'));
    t.addStep(this.sidebarStep('classes', '.nav-item[href="/teacher/meetings"]', 'Manage Classes', '🎥', 'Create Zoom meetings, invite students, and manage your class schedule.'));
    t.addStep(this.sidebarStep('attendance', '.nav-item[href="/admin/zoom-reports"]', 'Attendance', '📊', 'View Zoom meeting reports and student attendance records.'));
    t.addStep(this.sidebarStep('recordings', '.nav-item[href="/class-recordings"]', 'Class Recordings', '📹', 'Upload and manage class recordings for students to review.'));
    t.addStep(this.sidebarStep('ai-report', '.nav-item[href="/admin-analytics"]', 'AI Bot Report', '📈', 'Monitor how students are using the AI tutor — session counts, duration, and engagement.'));
    t.addStep(this.sidebarStep('timetable', '.nav-item[href="/time-table-view-teacher"]', 'Timetable', '📅', 'View your teaching schedule and upcoming classes.'));
    t.addStep(this.sidebarStep('profile', '.sidebar-footer .profile-link', 'Your Profile', '👤', 'View and update your profile information.'));

    t.addStep({
      ...this.centeredStep('finish', "You're ready to teach!", '🎉', 'Explore the portal and manage your classes. Happy teaching!', [
        { text: 'Finish Tour ✓', action: () => this.completeTour('TEACHER') }
      ]),
      beforeShowPromise: () => new Promise<void>((resolve) => { self.closeSidebarIfMobile(); setTimeout(resolve, 350); })
    });

    t.start();
  }

  private completeTour(role: string): void {
    this.markTourCompleted(role);
    if (this.tour) { this.tour.cancel(); this.tour = null; }
    this.closeSidebarIfMobile();
  }
}
