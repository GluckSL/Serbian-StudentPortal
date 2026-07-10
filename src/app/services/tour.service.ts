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
      const closeBtn = document.querySelector('.sidebar-mobile-close') as HTMLElement;
      const overlay = document.querySelector('.sidebar-overlay') as HTMLElement;
      if (closeBtn) closeBtn.click();
      else if (overlay) overlay.click();
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
    if (back) btns.push({ text: '← Nazad', action: () => this.tour.back(), classes: 'shepherd-button-secondary' });
    btns.push({ text: 'Sledeće →', action: () => this.tour.next() });
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

    t.addStep(this.centeredStep('welcome', 'Dobrodošli u Glück Global!', '👋', 'Dozvolite nam da vam ukratko pokažemo vaš studentski portal.', [
      { text: 'Preskoči obilazak', action: () => this.completeTour('STUDENT'), classes: 'shepherd-button-secondary' },
      { text: 'Počni obilazak →', action: () => t.next() }
    ]));

    t.addStep(this.sidebarStep('sidebar', '.sidebar .nav-body', 'Meni za navigaciju', '📌', 'Ovo je vaš glavni meni. Koristite ga za navigaciju između svih delova portala.', false));
    t.addStep(this.sidebarStep('dashboard', '.nav-item[href="/student-progress"]', 'Kontrolna tabla', '🏠', 'Vaša kontrolna tabla prikazuje sveukupni napredak — nivoe jezika, prisustvo, korišćenje AI bota, plaćanja i status vize na jednom mestu.'));
    t.addStep(this.sidebarStep('my-course', '.nav-item[href="/student/my-course"]', 'Moj kurs', '📖', 'Pristupite Zoom časovima, snimcima, digitalnim vežbama i AI modulima za učenje — sve na jednom mestu.'));
    t.addStep(this.sidebarStep('documents', '.nav-item[href="/student-documents"]', 'Dokumenti', '📁', 'Ovde otpremite i upravljajte potrebnim dokumentima. Administrativni tim će ih verifikovati za vašu vizu.'));
    t.addStep(this.sidebarStep('payments', '.nav-item[href="/my-payments"]', 'Moja plaćanja', '💳', 'Pregledajte zahteve za plaćanje, otpremite dokaz o plaćanju i pratite šta je plaćeno, a šta čeka.'));
    t.addStep(this.sidebarStep('visa', '.nav-item[href="/visa-status"]', 'Status vize', '✈️', 'Pratite napredak vaše vize korak po korak. Budite u toku sa statusom prijave.'));
    t.addStep(this.sidebarStep('profile', '.sidebar-footer .profile-link', 'Vaš profil', '👤', 'Pregledajte i ažurirajte podatke profila, uključujući fotografiju i kontakt informacije.'));

    t.addStep({
      ...this.centeredStep('finish', 'Sve je gotovo!', '🎉', 'Istražite portal i počnite svoje putovanje učenja. Ako vam je potrebna pomoć, kontaktirajte nastavnika ili administrativni tim.', [
        { text: 'Završi obilazak ✓', action: () => this.completeTour('STUDENT') }
      ]),
      beforeShowPromise: () => new Promise<void>((resolve) => { self.closeSidebarIfMobile(); setTimeout(resolve, 350); })
    });

    t.start();
  }

  startTeacherTour(): void {
    const t = this.createTour();
    const self = this;

    t.addStep(this.centeredStep('welcome', 'Dobrodošli, nastavniče!', '👋', 'Evo kratkog obilaska vašeg nastavničkog portala.', [
      { text: 'Preskoči obilazak', action: () => this.completeTour('TEACHER'), classes: 'shepherd-button-secondary' },
      { text: 'Počni obilazak →', action: () => t.next() }
    ]));

    t.addStep(this.sidebarStep('sidebar', '.sidebar .nav-body', 'Meni za navigaciju', '📌', 'Vaš glavni meni za pristup svim nastavničkim alatima i izveštajima.', false));
    t.addStep(this.sidebarStep('students', '.nav-item[href="/teacher-dashboard"]', 'Učenici', '👥', 'Pregledajte i upravljajte dodeljenim učenicima. Pratite njihov napredak, ažurirajte detalje i nadgledajte performanse.'));
    t.addStep(this.sidebarStep('modules', '.nav-item[href="/learning-modules"]', 'Moduli za učenje', '🤖', 'Kreirajte i upravljajte AI modulima za učenje i scenarijima za igranje uloga za vaše učenike.'));
    t.addStep(this.sidebarStep('exercises', '.nav-item[href="/admin/digital-exercises"]', 'Online vežbe', '🏋️', 'Kreirajte i upravljajte digitalnim vežbama — višestruki izbor, popunjavanje praznina, podudaranje, slušanje i još mnogo toga.'));
    t.addStep(this.sidebarStep('classes', '.nav-item[href="/teacher/meetings"]', 'Upravljanje časovima', '🎥', 'Kreirajte Zoom sastanke, pozovite učenike i upravljajte rasporedom časova.'));
    t.addStep(this.sidebarStep('attendance', '.nav-item[href="/admin/zoom-reports"]', 'Prisustvo', '📊', 'Pregledajte izveštaje Zoom sastanaka i evidenciju prisustva učenika.'));
    t.addStep(this.sidebarStep('recordings', '.nav-item[href="/class-recordings"]', 'Snimci časova', '📹', 'Otpremite i upravljajte snimcima časova kako bi ih učenici pregledali.'));
    t.addStep(this.sidebarStep('ai-report', '.nav-item[href="/admin-analytics"]', 'Izveštaj AI bota', '📈', 'Pratite kako učenici koriste AI tutora — broj sesija, trajanje i angažovanost.'));
    t.addStep(this.sidebarStep('timetable', '.nav-item[href="/time-table-view-teacher"]', 'Raspored', '📅', 'Pogledajte raspored predavanja i predstojeće časove.'));
    t.addStep(this.sidebarStep('profile', '.sidebar-footer .profile-link', 'Vaš profil', '👤', 'Pregledajte i ažurirajte podatke profila.'));

    t.addStep({
      ...this.centeredStep('finish', 'Spremni ste za predavanje!', '🎉', 'Istražite portal i upravljajte časovima. Srećno predavanje!', [
        { text: 'Završi obilazak ✓', action: () => this.completeTour('TEACHER') }
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
