import { Injectable } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/** Snapshot of what the student is doing — sent to Olly for smart replies. */
export interface OllyActivityContext {
  pageRoute: string;
  pageLabel: string;
  activityType?: string;
  exerciseId?: string;
  exerciseTitle?: string;
  exerciseCategory?: string;
  exerciseLevel?: string;
  exerciseType?: string;
  watchOnlyMode?: boolean;
  micRequired?: boolean;
  micVisible?: boolean;
  currentQuestionIndex?: number;
  totalQuestions?: number;
  currentQuestionType?: string;
  currentQuestionPrompt?: string;
  videoPlaybackEnded?: boolean;
  journeyDay?: number;
  capturedAt: string;
}

@Injectable({ providedIn: 'root' })
export class OllyContextService {
  private snapshot: OllyActivityContext = this.emptySnapshot('/');

  constructor(private router: Router) {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.onRouteChange();
    });
    this.onRouteChange();
  }

  /** Called by activity components (e.g. digital exercise player) with rich detail. */
  setActivityDetail(partial: Partial<Omit<OllyActivityContext, 'pageRoute' | 'pageLabel' | 'capturedAt'>>): void {
    this.snapshot = {
      ...this.snapshot,
      ...partial,
      capturedAt: new Date().toISOString()
    };
  }

  clearActivityDetail(): void {
    this.snapshot = {
      ...this.emptySnapshot(this.snapshot.pageRoute),
      pageLabel: this.snapshot.pageLabel
    };
  }

  getSnapshot(): OllyActivityContext {
    return { ...this.snapshot };
  }

  private onRouteChange(): void {
    const route = (this.router.url.split('?')[0] || '/').slice(0, 512);
    if (!this.isExerciseRoute(route)) {
      this.snapshot = {
        ...this.emptySnapshot(route),
        pageLabel: this.labelFromRoute(route),
        activityType: this.activityTypeFromRoute(route)
      };
      return;
    }
    // Exercise player updates detail itself — only refresh route/label here.
    this.snapshot = {
      ...this.snapshot,
      pageRoute: route,
      pageLabel: this.labelFromRoute(route),
      capturedAt: new Date().toISOString()
    };
  }

  private isExerciseRoute(route: string): boolean {
    return /\/digital-exercises\/[^/]+\/play(\/freemode)?/.test(route);
  }

  private emptySnapshot(route: string): OllyActivityContext {
    return {
      pageRoute: route,
      pageLabel: this.labelFromRoute(route),
      capturedAt: new Date().toISOString()
    };
  }

  private labelFromRoute(route: string): string {
    if (/\/digital-exercises\/[^/]+\/play(\/freemode)?/.test(route)) return 'Digital Exercise — Vocab / Activity Player';
    if (route.includes('/my-course')) return 'My Course';
    if (route.includes('/student-progress')) return 'Student Progress';
    if (route.includes('/class-recordings')) return 'Class Recordings';
    if (route.includes('/time-table')) return 'Timetable';
    if (route.includes('/payment')) return 'Payments';
    if (route.includes('/help')) return 'Help & Support';
    if (route.includes('/profile')) return 'Profile';
    if (route === '/home' || route === '/') return 'Home';
    if (route.includes('/login')) return 'Login';
    return route.replace(/^\//, '') || 'Portal';
  }

  private activityTypeFromRoute(route: string): string | undefined {
    if (/\/digital-exercises\/[^/]+\/play(\/freemode)?/.test(route)) return 'digital-exercise';
    if (route.includes('/my-course')) return 'my-course';
    if (route.includes('/class-recordings')) return 'class-recordings';
    return undefined;
  }
}
