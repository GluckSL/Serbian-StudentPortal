import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { MaterialModule } from '../../shared/material.module';
import { MatSnackBar } from '@angular/material/snack-bar';
import { environment } from '../../../environments/environment';

interface BulkUploadResult {
  success: boolean;
  message: string;
  summary: {
    total: number;
    successful: number;
    failed: number;
    skipped: number;
  };
  results: {
    successful: any[];
    failed: any[];
    skipped: any[];
  };
}

@Component({
  selector: 'app-bulk-student-upload',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MaterialModule
  ],
  template: `
    <div class="bulk-upload-container">
      <mat-card>
        <mat-card-header>
          <mat-card-title>
            <mat-icon>upload_file</mat-icon>
            Bulk Student Upload
          </mat-card-title>
        </mat-card-header>

        <mat-card-content>
          <!-- Instructions -->
          <div class="instructions">
            <h3>📋 Instructions</h3>
            <ol>
              <li>Download the CSV template below</li>
              <li>Fill in student details (required fields marked with *)</li>
              <li>Upload the completed CSV file</li>
              <li>Review the results and download credentials</li>
            </ol>

            <div class="important-note">
              <h4>📧 Existing Email Handling:</h4>
              <p>If an email address already exists in the system:</p>
              <ul>
                <li>✅ A <strong>new password</strong> will be generated</li>
                <li>✅ Credentials will be <strong>resent</strong> to that email</li>
                <li>✅ No duplicate entry will be created</li>
                <li>✅ The existing student's RegNo will be used</li>
              </ul>
            </div>

            <div class="required-fields">
              <h4>Required Fields:</h4>
              <ul>
                <li><strong>name*</strong> - Student full name</li>
                <li><strong>email*</strong> - Unique email address</li>
                <li><strong>subscription*</strong> - SILVER or PLATINUM</li>
                <li><strong>level*</strong> - A1, A2, B1, B2, C1, or C2</li>
                <li><strong>studentStatus*</strong> - ONGOING, COMPLETED, PAUSED, etc.</li>
              </ul>

              <h4>Optional Fields:</h4>
              <ul>
                <li><strong>medium</strong> - Online, Offline, Hybrid</li>
                <li><strong>batch</strong> - Batch name</li>
                <li><strong>phoneNumber</strong> - Contact number</li>
                <li><strong>address</strong> - Physical address</li>
                <li><strong>age</strong> - Student age</li>
                <li><strong>servicesOpted</strong> - Service/program name</li>
                <li><strong>leadSource</strong> - Marketing source</li>
              </ul>
            </div>
          </div>

          <!-- Download Template -->
          <div class="template-section">
            <button mat-raised-button color="primary" (click)="downloadTemplate()">
              <mat-icon>download</mat-icon>
              Download CSV Template
            </button>
          </div>

          <!-- File Upload -->
          <div class="upload-section">
            <input
              type="file"
              #fileInput
              accept=".csv"
              (change)="onFileSelected($event)"
              style="display: none"
            />
            <button mat-raised-button color="accent" (click)="fileInput.click()" [disabled]="uploading">
              <mat-icon>attach_file</mat-icon>
              Select CSV File
            </button>
            <span *ngIf="selectedFile" class="file-name">{{ selectedFile.name }}</span>
          </div>

          <!-- Send Emails Option -->
          <div class="options-section">
            <mat-checkbox [(ngModel)]="sendEmails">
              Send welcome emails with credentials to students
            </mat-checkbox>
          </div>

          <!-- Upload Button -->
          <div class="action-section" *ngIf="selectedFile">
            <button mat-raised-button color="primary" (click)="uploadFile()" [disabled]="uploading">
              <mat-icon>cloud_upload</mat-icon>
              Upload and Create Students
            </button>
          </div>

          <!-- Progress Bar -->
          <mat-progress-bar *ngIf="uploading" mode="indeterminate"></mat-progress-bar>

          <!-- Results Summary -->
          <div class="results-summary" *ngIf="uploadResult">
            <h3>📊 Upload Results</h3>
            <div class="summary-cards">
              <div class="summary-card total">
                <div class="card-value">{{ uploadResult.summary.total }}</div>
                <div class="card-label">Total Rows</div>
              </div>
              <div class="summary-card success">
                <div class="card-value">{{ uploadResult.summary.successful }}</div>
                <div class="card-label">Successful</div>
              </div>
              <div class="summary-card failed">
                <div class="card-value">{{ uploadResult.summary.failed }}</div>
                <div class="card-label">Failed</div>
              </div>
              <div class="summary-card skipped">
                <div class="card-value">{{ uploadResult.summary.skipped }}</div>
                <div class="card-label">Skipped</div>
              </div>
            </div>

            <!-- Download Credentials -->
            <div class="download-section" *ngIf="uploadResult.results.successful.length > 0">
              <button mat-raised-button color="primary" (click)="downloadCredentials()">
                <mat-icon>download</mat-icon>
                Download Credentials ({{ uploadResult.results.successful.length }} students)
              </button>
            </div>
          </div>

          <!-- Successful Students Table -->
          <div class="results-table" *ngIf="uploadResult && uploadResult.results.successful.length > 0">
            <h4>✅ Successfully Processed ({{ uploadResult.results.successful.length }})</h4>
            <table mat-table [dataSource]="uploadResult.results.successful" class="results-mat-table">
              <ng-container matColumnDef="row">
                <th mat-header-cell *matHeaderCellDef>Row</th>
                <td mat-cell *matCellDef="let element">{{ element.row }}</td>
              </ng-container>
              <ng-container matColumnDef="action">
                <th mat-header-cell *matHeaderCellDef>Action</th>
                <td mat-cell *matCellDef="let element">
                  <span [class]="element.isExistingUser ? 'badge-resent' : 'badge-new'">
                    {{ element.isExistingUser ? '🔄 Credentials Resent' : '✨ New User Created' }}
                  </span>
                </td>
              </ng-container>
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef>Name</th>
                <td mat-cell *matCellDef="let element">{{ element.name }}</td>
              </ng-container>
              <ng-container matColumnDef="email">
                <th mat-header-cell *matHeaderCellDef>Email</th>
                <td mat-cell *matCellDef="let element">{{ element.email }}</td>
              </ng-container>
              <ng-container matColumnDef="regNo">
                <th mat-header-cell *matHeaderCellDef>RegNo</th>
                <td mat-cell *matCellDef="let element">{{ element.regNo }}</td>
              </ng-container>
              <ng-container matColumnDef="password">
                <th mat-header-cell *matHeaderCellDef>Password</th>
                <td mat-cell *matCellDef="let element">{{ element.password }}</td>
              </ng-container>
              <ng-container matColumnDef="emailSent">
                <th mat-header-cell *matHeaderCellDef>Email Sent</th>
                <td mat-cell *matCellDef="let element">
                  <mat-icon [class.success-icon]="element.emailSent" [class.error-icon]="!element.emailSent">
                    {{ element.emailSent ? 'check_circle' : 'cancel' }}
                  </mat-icon>
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="successColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: successColumns;"></tr>
            </table>
          </div>

          <!-- Failed Students Table -->
          <div class="results-table" *ngIf="uploadResult && uploadResult.results.failed.length > 0">
            <h4>❌ Failed ({{ uploadResult.results.failed.length }})</h4>
            <table mat-table [dataSource]="uploadResult.results.failed" class="results-mat-table">
              <ng-container matColumnDef="row">
                <th mat-header-cell *matHeaderCellDef>Row</th>
                <td mat-cell *matCellDef="let element">{{ element.row }}</td>
              </ng-container>
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef>Name</th>
                <td mat-cell *matCellDef="let element">{{ element.data?.name || 'N/A' }}</td>
              </ng-container>
              <ng-container matColumnDef="email">
                <th mat-header-cell *matHeaderCellDef>Email</th>
                <td mat-cell *matCellDef="let element">{{ element.data?.email || 'N/A' }}</td>
              </ng-container>
              <ng-container matColumnDef="reason">
                <th mat-header-cell *matHeaderCellDef>Reason</th>
                <td mat-cell *matCellDef="let element" class="error-text">{{ element.reason }}</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="failedColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: failedColumns;"></tr>
            </table>
          </div>

          <!-- Skipped Students Table -->
          <div class="results-table" *ngIf="uploadResult && uploadResult.results.skipped.length > 0">
            <h4>⚠️ Skipped ({{ uploadResult.results.skipped.length }})</h4>
            <table mat-table [dataSource]="uploadResult.results.skipped" class="results-mat-table">
              <ng-container matColumnDef="row">
                <th mat-header-cell *matHeaderCellDef>Row</th>
                <td mat-cell *matCellDef="let element">{{ element.row }}</td>
              </ng-container>
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef>Name</th>
                <td mat-cell *matCellDef="let element">{{ element.data?.name || 'N/A' }}</td>
              </ng-container>
              <ng-container matColumnDef="email">
                <th mat-header-cell *matHeaderCellDef>Email</th>
                <td mat-cell *matCellDef="let element">{{ element.data?.email || 'N/A' }}</td>
              </ng-container>
              <ng-container matColumnDef="reason">
                <th mat-header-cell *matHeaderCellDef>Reason</th>
                <td mat-cell *matCellDef="let element" class="warning-text">{{ element.reason }}</td>
              </ng-container>
              <ng-container matColumnDef="existingRegNo">
                <th mat-header-cell *matHeaderCellDef>Existing RegNo</th>
                <td mat-cell *matCellDef="let element">{{ element.existingRegNo || 'N/A' }}</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="skippedColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: skippedColumns;"></tr>
            </table>
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .bulk-upload-container {
      padding: 20px;
      max-width: 1400px;
      margin: 0 auto;
    }

    mat-card-header {
      margin-bottom: 20px;
    }

    mat-card-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 24px;
    }

    .instructions {
      background: #f5f5f5;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }

    .instructions h3 {
      margin-top: 0;
      color: #1976d2;
    }

    .instructions ol {
      margin: 10px 0;
    }

    .important-note {
      margin: 15px 0;
      padding: 15px;
      background: #e3f2fd;
      border-left: 4px solid #2196f3;
      border-radius: 4px;
    }

    .important-note h4 {
      margin: 0 0 10px 0;
      color: #1976d2;
    }

    .important-note p {
      margin: 5px 0;
      color: #333;
    }

    .important-note ul {
      margin: 10px 0;
      padding-left: 20px;
    }

    .required-fields {
      margin-top: 15px;
    }

    .required-fields h4 {
      margin: 10px 0 5px 0;
      color: #333;
    }

    .required-fields ul {
      margin: 5px 0;
      padding-left: 20px;
    }

    .template-section,
    .upload-section,
    .options-section,
    .action-section,
    .download-section {
      margin: 20px 0;
    }

    .file-name {
      margin-left: 15px;
      color: #666;
      font-style: italic;
    }

    .results-summary {
      margin-top: 30px;
      padding: 20px;
      background: #f9f9f9;
      border-radius: 8px;
    }

    .results-summary h3 {
      margin-top: 0;
      color: #1976d2;
    }

    .summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin: 20px 0;
    }

    .summary-card {
      padding: 20px;
      border-radius: 8px;
      text-align: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .summary-card.total {
      background: #2196f3;
      color: white;
    }

    .summary-card.success {
      background: #4caf50;
      color: white;
    }

    .summary-card.failed {
      background: #f44336;
      color: white;
    }

    .summary-card.skipped {
      background: #ff9800;
      color: white;
    }

    .card-value {
      font-size: 36px;
      font-weight: bold;
      margin-bottom: 5px;
    }

    .card-label {
      font-size: 14px;
      opacity: 0.9;
    }

    .results-table {
      margin-top: 30px;
    }

    .results-table h4 {
      margin-bottom: 15px;
      color: #333;
    }

    .results-mat-table {
      width: 100%;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .success-icon {
      color: #4caf50;
    }

    .error-icon {
      color: #f44336;
    }

    .error-text {
      color: #f44336;
    }

    .warning-text {
      color: #ff9800;
    }

    .badge-new {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      background-color: #4caf50;
      color: white;
      font-size: 12px;
      font-weight: bold;
    }

    .badge-resent {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      background-color: #2196f3;
      color: white;
      font-size: 12px;
      font-weight: bold;
    }

    mat-progress-bar {
      margin: 20px 0;
    }

    button {
      margin-right: 10px;
    }
  `]
})
export class BulkStudentUploadComponent {
  selectedFile: File | null = null;
  uploading = false;
  sendEmails = true;
  uploadResult: BulkUploadResult | null = null;

  successColumns = ['row', 'action', 'name', 'email', 'regNo', 'password', 'emailSent'];
  failedColumns = ['row', 'name', 'email', 'reason'];
  skippedColumns = ['row', 'name', 'email', 'reason', 'existingRegNo'];

  constructor(
    private http: HttpClient,
    private snackBar: MatSnackBar
  ) {}

  downloadTemplate() {
    const csvContent = `name,email,subscription,level,studentStatus,medium,batch,phoneNumber,address,age,servicesOpted,leadSource
John Doe,john@example.com,PLATINUM,A1,ONGOING,Online,Batch A,+94771234567,"Colombo, Sri Lanka",25,German Language Course,Facebook
Jane Smith,jane@example.com,SILVER,A2,ONGOING,Offline,Batch B,+94771234568,"Kandy, Sri Lanka",30,Business German,Referral`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'bulk_student_upload_template.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    this.snackBar.open('Template downloaded successfully', 'Close', { duration: 3000 });
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file && file.type === 'text/csv') {
      this.selectedFile = file;
      this.uploadResult = null;
    } else {
      this.snackBar.open('Please select a valid CSV file', 'Close', { duration: 3000 });
    }
  }

  uploadFile() {
    if (!this.selectedFile) return;

    this.uploading = true;
    const reader = new FileReader();

    reader.onload = (e: any) => {
      const csvData = e.target.result;
      const students = this.parseCSV(csvData);

      if (students.length === 0) {
        this.snackBar.open('No valid data found in CSV file', 'Close', { duration: 3000 });
        this.uploading = false;
        return;
      }

      const token = localStorage.getItem('authToken');
      const headers = new HttpHeaders({
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      });

      this.http.post<BulkUploadResult>(
        `${environment.apiUrl}/auth/bulk-upload-students`,
        { students, sendEmails: this.sendEmails },
        { headers }
      ).subscribe({
        next: (result) => {
          this.uploadResult = result;
          this.uploading = false;
          this.snackBar.open(
            `Upload complete: ${result.summary.successful} successful, ${result.summary.failed} failed, ${result.summary.skipped} skipped`,
            'Close',
            { duration: 5000 }
          );
        },
        error: (error) => {
          console.error('Upload error:', error);
          this.uploading = false;
          this.snackBar.open(
            error.error?.message || 'Error uploading students',
            'Close',
            { duration: 5000 }
          );
        }
      });
    };

    reader.readAsText(this.selectedFile);
  }

  parseCSV(csvData: string): any[] {
    const lines = csvData.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    const students = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length === headers.length) {
        const student: any = {};
        headers.forEach((header, index) => {
          student[header] = values[index].trim();
        });
        students.push(student);
      }
    }

    return students;
  }

  parseCSVLine(line: string): string[] {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);

    return result;
  }

  downloadCredentials() {
    if (!this.uploadResult || this.uploadResult.results.successful.length === 0) return;

    const csvContent = 'Name,Email,Registration No,Password,Email Sent\n' +
      this.uploadResult.results.successful.map(s =>
        `"${s.name}","${s.email}","${s.regNo}","${s.password}","${s.emailSent ? 'Yes' : 'No'}"`
      ).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `student_credentials_${timestamp}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    this.snackBar.open('Credentials downloaded successfully', 'Close', { duration: 3000 });
  }
}
