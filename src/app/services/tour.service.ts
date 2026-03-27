import { Injectable } from '@angular/core';
import Shepherd from 'shepherd.js';

@Injectable({ providedIn: 'root' })
export class TourService {
  private tour: any = null;
  private readonly STORAGE_KEY = 'gluck_tour_completed';

  hasCompletedTour(): boolean {
    return localStorage.getItem(this.STORAGE_KEY) === 'true';
  }

  markTourCompleted(): void {
    localStorage.setItem(this.STORAGE_KEY, 'true');
  }

  resetTour(): void {
    localStorage.removeItem(this.STORAGE_KEY);
  }

  startStudentTour(): void {
    if (this.tour) { this.tour.cancel(); }

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

    this.tour.addStep({
      id: 'welcome',
      text: `
        <div style="text-align:center;padding:8px 0;">
          <div style="font-size:32px;margin-bottom:8px;">👋</div>
          <h3 style="margin:0 0 8px;font-size:16px;color:#011f4b;">Welcome to Glück Global!</h3>
          <p style="margin:0;font-size:13px;color:#64748b;">Let us give you a quick tour of your student portal.</p>
        </div>
      `,
      buttons: [
        { text: 'Skip Tour', action: () => this.completeTour(), classes: 'shepherd-button-secondary' },
        { text: 'Start Tour →', action: () => this.tour!.next() }
      ]
    });

    this.tour.addStep({
      id: 'sidebar',
      attachTo: { element: '.sidebar .nav-body', on: 'right' },
      text: `
        <h3 style="margin:0 0 6px;font-size:14px;color:#011f4b;">📌 Navigation Menu</h3>
        <p style="margin:0;font-size:13px;color:#64748b;">This is your main menu. Use it to navigate between all sections of the portal.</p>
      `,
      buttons: [
        { text: '← Back', action: () => this.tour!.back(), classes: 'shepherd-button-secondary' },
        { text: 'Next →', action: () => this.tour!.next() }
      ]
    });

    this.tour.addStep({
      id: 'dashboard',
      attachTo: { element: '.nav-item[href="/student-progress"], a[ng-reflect-router-link="/student-progress"]', on: 'right' },
      text: `
        <h3 style="margin:0 0 6px;font-size:14px;color:#011f4b;">🏠 Dashboard</h3>
        <p style="margin:0;font-size:13px;color:#64748b;">Your dashboard shows your overall progress — language levels, attendance, AI bot usage, payments, and visa status at a glance.</p>
      `,
      buttons: [
        { text: '← Back', action: () => this.tour!.back(), classes: 'shepherd-button-secondary' },
        { text: 'Next →', action: () => this.tour!.next() }
      ]
    });

    this.tour.addStep({
      id: 'my-course',
      attachTo: { element: '.nav-item[href="/student/my-course"], a[ng-reflect-router-link="/student/my-course"]', on: 'right' },
      text: `
        <h3 style="margin:0 0 6px;font-size:14px;color:#011f4b;">📖 My Course</h3>
        <p style="margin:0;font-size:13px;color:#64748b;">Access your Zoom classes, class recordings, digital exercises, and AI learning modules — all in one place.</p>
      `,
      buttons: [
        { text: '← Back', action: () => this.tour!.back(), classes: 'shepherd-button-secondary' },
        { text: 'Next →', action: () => this.tour!.next() }
      ]
    });

    this.tour.addStep({
      id: 'documents',
      attachTo: { element: '.nav-item[href="/student-documents"], a[ng-reflect-router-link="/student-documents"]', on: 'right' },
      text: `
        <h3 style="margin:0 0 6px;font-size:14px;color:#011f4b;">📁 Documents</h3>
        <p style="margin:0;font-size:13px;color:#64748b;">Upload and manage your required documents here. The admin team will verify them for your visa process.</p>
      `,
      buttons: [
        { text: '← Back', action: () => this.tour!.back(), classes: 'shepherd-button-secondary' },
        { text: 'Next →', action: () => this.tour!.next() }
      ]
    });

    this.tour.addStep({
      id: 'payments',
      attachTo: { element: '.nav-item[href="/student-payments"], a[ng-reflect-router-link="/student-payments"]', on: 'right' },
      text: `
        <h3 style="margin:0 0 6px;font-size:14px;color:#011f4b;">💳 Payments</h3>
        <p style="margin:0;font-size:13px;color:#64748b;">View your payment summary, invoices, and payment history. Track what's been paid and what's pending.</p>
      `,
      buttons: [
        { text: '← Back', action: () => this.tour!.back(), classes: 'shepherd-button-secondary' },
        { text: 'Next →', action: () => this.tour!.next() }
      ]
    });

    this.tour.addStep({
      id: 'visa',
      attachTo: { element: '.nav-item[href="/visa-status"], a[ng-reflect-router-link="/visa-status"]', on: 'right' },
      text: `
        <h3 style="margin:0 0 6px;font-size:14px;color:#011f4b;">✈️ Visa Status</h3>
        <p style="margin:0;font-size:13px;color:#64748b;">Track your visa application progress step by step. Stay updated on your application status.</p>
      `,
      buttons: [
        { text: '← Back', action: () => this.tour!.back(), classes: 'shepherd-button-secondary' },
        { text: 'Next →', action: () => this.tour!.next() }
      ]
    });

    this.tour.addStep({
      id: 'profile',
      attachTo: { element: '.sidebar-footer .profile-link', on: 'right' },
      text: `
        <h3 style="margin:0 0 6px;font-size:14px;color:#011f4b;">👤 Your Profile</h3>
        <p style="margin:0;font-size:13px;color:#64748b;">View and update your profile information, including your photo and contact details.</p>
      `,
      buttons: [
        { text: '← Back', action: () => this.tour!.back(), classes: 'shepherd-button-secondary' },
        { text: 'Next →', action: () => this.tour!.next() }
      ]
    });

    this.tour.addStep({
      id: 'finish',
      text: `
        <div style="text-align:center;padding:8px 0;">
          <div style="font-size:32px;margin-bottom:8px;">🎉</div>
          <h3 style="margin:0 0 8px;font-size:16px;color:#011f4b;">You're all set!</h3>
          <p style="margin:0;font-size:13px;color:#64748b;">Explore the portal and start your learning journey. If you need help, contact your teacher or the admin team.</p>
        </div>
      `,
      buttons: [
        { text: 'Finish Tour ✓', action: () => this.completeTour() }
      ]
    });

    this.tour.start();
  }

  private completeTour(): void {
    this.markTourCompleted();
    if (this.tour) { this.tour.cancel(); this.tour = null; }
  }
}
