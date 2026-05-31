import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class DgTtsService {
  private readonly url = `${environment.apiUrl}/dg/tts`;

  constructor(private http: HttpClient) {}

  synthesize(text: string, voice?: string): Observable<Blob> {
    return this.http.post(this.url, { text, voice }, { responseType: 'blob' });
  }
}
