//student-card.component.ts

import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { MaterialModule } from '../shared/material.module';


@Component({
  selector: 'app-student-card',
  standalone: true,
  imports: [ CommonModule,
    MaterialModule,],
  templateUrl: './student-card.component.html',
  styleUrl: './student-card.component.css'
})
export class StudentCardComponent {
  @Input() student: any; // shape: { name, email, verageFluency, averageGrammar, progress, photo }

}
