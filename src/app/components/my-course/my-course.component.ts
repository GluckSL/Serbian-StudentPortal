import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { StudentProgressService } from '../../services/student-progress.service';
import { StudentMeetingsComponent } from '../meeting-link/student-meetings.component';
import { StudentRecordingsComponent } from '../class-recordings/student-recordings/student-recordings.component';
import { DigitalExercisesComponent } from '../digital-exercises/digital-exercises.component';
import { LearningModulesComponent } from '../learning-modules/learning-modules.component';

type MyCourseTab = 'classes' | 'exercises' | 'modules';

@Component({
  selector: 'app-my-course',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    StudentMeetingsComponent,
    StudentRecordingsComponent,
    DigitalExercisesComponent,
    LearningModulesComponent
  ],
  templateUrl: './my-course.component.html',
  styleUrls: ['./my-course.component.scss']
})
export class MyCourseComponent implements OnInit {
  journey: any = null;
  loading = true;
  activeTab: MyCourseTab = 'classes';

  constructor(
    private progressService: StudentProgressService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.progressService.getStudentJourney().subscribe({
      next: (res) => {
        this.journey = res;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });

    this.route.queryParamMap.subscribe((q) => {
      const t = q.get('tab');
      if (t === 'exercises' || t === 'modules' || t === 'classes') {
        this.activeTab = t;
      }
    });
  }

  setTab(tab: MyCourseTab): void {
    this.activeTab = tab;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  get levelProgression(): any[] {
    return this.journey?.levelProgression || [];
  }

  get profile(): any {
    return this.journey?.profile || {};
  }

  get studentFirstName(): string {
    const name = (this.profile?.name || '').trim();
    if (!name) return 'there';
    return name.split(/\s+/)[0];
  }

  /** Short level code for the hero (e.g. A2, B1). */
  get levelShortLabel(): string {
    const cur = this.levelProgression.find((l: any) => l.status === 'in-progress');
    if (cur?.level) return String(cur.level);
    const fromProfile = this.profile?.currentLevel;
    if (fromProfile) return String(fromProfile).split(/\s+/)[0];
    return '—';
  }

  get learningPct(): number {
    const lp = this.levelProgression;
    const completed = lp.filter((l: any) => l.status === 'completed').length;
    return lp.length ? Math.round((completed / lp.length) * 100) : 0;
  }

}
