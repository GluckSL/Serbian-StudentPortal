//main.ts

if (!('try' in Promise)) {
  (Promise as any).try = function <T>(fn: () => T | PromiseLike<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      try { resolve(fn()); } catch (e) { reject(e); }
    });
  };
}

import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app/app-routing.module';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { importProvidersFrom } from '@angular/core';
import { authExpiredInterceptor } from './app/interceptors/auth-expired.interceptor';
import { authTokenInterceptor } from './app/interceptors/auth-token.interceptor';
import { MaterialModule } from './app/shared/material.module';
//import { provideAnimations } from './app/app.component';
import { provideAnimations } from '@angular/platform-browser/animations';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';


bootstrapApplication(AppComponent, {
  providers: [
    importProvidersFrom(
      MaterialModule,  // ✅ Wrap in importProvidersFrom
      BrowserAnimationsModule,
    ),
    provideHttpClient(withInterceptors([authTokenInterceptor, authExpiredInterceptor])),
    provideRouter(routes, withComponentInputBinding()),
    provideAnimations(),
  ]
}).catch(err => console.error(err));
