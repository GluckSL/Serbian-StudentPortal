import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { StudentProgressService } from '../../services/student-progress.service';

@Component({
  selector: 'app-visa-status',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './visa-status.component.html',
  styleUrls: ['./visa-status.component.css']
})
export class VisaStatusComponent implements OnInit {
  isLoading = true;
  visa: any = { steps: [], stages: [], currentStep: 0, totalSteps: 0, route: '', finalOutcome: '', finalOutcomeNote: '', history: [], dates: {} };
  profile: any = {};

  constructor(private progressService: StudentProgressService) {}

  ngOnInit(): void {
    this.progressService.getStudentJourney().subscribe({
      next: (res: any) => {
        this.visa = res.visa || this.visa;
        this.profile = res.profile || {};
        this.isLoading = false;
      },
      error: () => { this.isLoading = false; }
    });
  }

  get visaStageDates(): any[] {
    return (this.visa.stages || [])
      .filter((s: any) => s.stageDate && s.stageDateLabel)
      .map((s: any) => ({ label: this.translateVisaLabel(s.stageDateLabel), date: s.stageDate }));
  }

  get progressPct(): number {
    return this.visa.totalSteps ? Math.round((this.visa.currentStep / this.visa.totalSteps) * 100) : 0;
  }

  formatDate(d: string | Date): string {
    if (!d) return '';
    return new Date(d).toLocaleDateString('sr-Latn-RS', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  translateVisaLabel(value: string): string {
    const labels: Record<string, string> = {
      'Not set': 'Nije podešeno',
      'Portal Visa': 'Portal viza',
      'Application Filed': 'Prijava podneta',
      'Preliminary Review': 'Preliminarni pregled',
      'Embassy Review': 'Pregled ambasade',
      'Embassy Feedback': 'Povratna informacija ambasade',
      'Changes / Appointment': 'Izmene / termin',
      'Final Submission & Decision': 'Konačno podnošenje i odluka',
      'Appointment Booking': 'Zakazivanje termina',
      'Document Preparation': 'Priprema dokumenata',
      'Interview Preparation': 'Priprema za razgovor',
      'Embassy Visit': 'Poseta ambasadi',
      'Result & Next Steps': 'Rezultat i sledeći koraci',
      'Application Date': 'Datum prijave',
      'Embassy Submission Date': 'Datum podnošenja ambasadi',
      'Appointment Date': 'Datum termina',
      'Embassy Visit Date': 'Datum posete ambasadi',
    };
    return labels[value] || value;
  }

  outcomeLabel(value: string): string {
    const labels: Record<string, string> = {
      completed: 'Završeno',
      rejected: 'Odbijeno',
      in_progress: 'U toku',
      approved: 'Odobreno',
      pending: 'Na čekanju',
    };
    return labels[value] || value;
  }
}
