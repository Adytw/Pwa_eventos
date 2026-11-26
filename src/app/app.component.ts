import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonApp } from '@ionic/angular';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import QRCode from 'qrcode';
import { AttendanceRecord, EventRecord, RegistrationRecord, TicketQrPayload, TicketRecord, UserRole } from './core/models';
import { db, seedDemoData } from './core/eventpass-db';
import { CloudService } from './core/cloud.service';

type Section = 'dashboard' | 'events' | 'registrations' | 'tickets' | 'scanner' | 'attendance' | 'reports' | 'settings';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

@Component({
  selector: 'ep-root',
  standalone: true,
  imports: [CommonModule, FormsModule, IonApp],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('videoElement') videoElement?: ElementRef<HTMLVideoElement>;

  section: Section = 'dashboard';
  isOnline = navigator.onLine;
  installed = window.matchMedia('(display-mode: standalone)').matches;
  deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
  currentRole: UserRole = 'admin';
  currentUserName = 'Adriana García';

  events: EventRecord[] = [];
  registrations: RegistrationRecord[] = [];
  tickets: TicketRecord[] = [];
  attendance: AttendanceRecord[] = [];

  isEventFormOpen = false;
  editingEventId: string | null = null;
  eventForm = this.emptyEventForm();
  eventCoordinates: { latitude: number; longitude: number } | null = null;
  registrationForm = { eventId: '', attendeeName: '', email: '' };
  scannerInput = '';
  scannerActive = false;
  scannerMessage = '';
  scannerResult: 'success' | 'error' | 'warning' | '' = '';
  isSyncing = false;
  cloudEmail = '';
  cloudPassword = '';
  cloudSignedIn = false;
  toastMessage = '';
  ticketPreview: TicketRecord | null = null;
  ticketQrDataUrl = '';
  private reader: BrowserMultiFormatReader | null = null;
  private scannerControls: IScannerControls | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly onOnline = (): void => {
    this.isOnline = true;
    this.showToast('Conexión recuperada. Puedes sincronizar los registros pendientes.');
    void this.refreshData();
  };

  private readonly onOffline = (): void => {
    this.isOnline = false;
    this.showToast('Sin conexión. EventPass seguirá usando los datos guardados en este dispositivo.');
  };

  private readonly onBeforeInstallPrompt = (event: Event): void => {
    event.preventDefault();
    this.deferredInstallPrompt = event as BeforeInstallPromptEvent;
  };

  constructor(public readonly cloud: CloudService) {}

  async ngOnInit(): Promise<void> {
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    window.addEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
    await seedDemoData();
    await this.refreshData();
    this.cloudSignedIn = await this.cloud.hasSession().catch(() => false);
  }

  ngAfterViewInit(): void {}

  ngOnDestroy(): void {
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    window.removeEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
    this.stopScanner();
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  private emptyEventForm(): {
    title: string; category: string; description: string; location: string;
    startsAt: string; capacity: number; status: 'draft' | 'published';
  } {
    const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return {
      title: '', category: 'Tecnología', description: '', location: '',
      startsAt: date.toISOString().slice(0, 16), capacity: 100, status: 'published'
    };
  }

  async refreshData(): Promise<void> {
    const [events, registrations, tickets, attendance] = await Promise.all([
      db.events.orderBy('startsAt').toArray(),
      db.registrations.orderBy('registeredAt').reverse().toArray(),
      db.tickets.orderBy('createdAt').reverse().toArray(),
      db.attendance.orderBy('scannedAt').reverse().toArray()
    ]);
    this.events = events;
    this.registrations = registrations;
    this.tickets = tickets;
    this.attendance = attendance;
    if (!this.registrationForm.eventId && events.length) this.registrationForm.eventId = events[0].id;
  }

  navigate(section: Section): void {
    this.stopScanner();
    this.ticketPreview = null;
    this.section = section;
    this.scannerMessage = '';
    this.scannerResult = '';
  }

  get publishedEvents(): EventRecord[] {
    return this.events.filter((event) => event.status === 'published');
  }

  get pendingAttendanceCount(): number {
    return this.attendance.filter((record) => record.syncStatus === 'pending').length;
  }

  get totalCapacity(): number {
    return this.events.filter((event) => event.status !== 'draft').reduce((total, event) => total + event.capacity, 0);
  }

  registrationCount(eventId: string): number {
    return this.registrations.filter((item) => item.eventId === eventId).length;
  }

  get attendanceRate(): number {
    const confirmed = this.registrations.filter((item) => item.status === 'confirmed').length;
    return confirmed ? Math.round((this.attendance.length / confirmed) * 100) : 0;
  }

  get upcomingEvents(): EventRecord[] {
    return this.events.filter((event) => new Date(event.startsAt).getTime() >= Date.now()).slice(0, 4);
  }

  get roleLabel(): string {
    const labels: Record<UserRole, string> = {
      admin: 'Administrador', organizer: 'Organizador', staff: 'Personal de acceso', attendee: 'Participante'
    };
    return labels[this.currentRole];
  }

  eventTitle(eventId: string): string {
    return this.events.find((event) => event.id === eventId)?.title ?? 'Evento no disponible';
  }

  formatDate(value: string): string {
    return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  openNewEvent(): void {
    this.editingEventId = null;
    this.eventForm = this.emptyEventForm();
    this.eventCoordinates = null;
    this.isEventFormOpen = true;
  }

  editEvent(event: EventRecord): void {
    const localDate = new Date(event.startsAt);
    localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
    this.eventForm = {
      title: event.title,
      category: event.category,
      description: event.description,
      location: event.location,
      startsAt: localDate.toISOString().slice(0, 16),
      capacity: event.capacity,
      status: event.status === 'draft' ? 'draft' : 'published'
    };
    this.eventCoordinates = event.latitude && event.longitude
      ? { latitude: event.latitude, longitude: event.longitude }
      : null;
    this.editingEventId = event.id;
    this.isEventFormOpen = true;
  }

  async saveEvent(): Promise<void> {
    if (!this.eventForm.title.trim() || !this.eventForm.location.trim() || !this.eventForm.startsAt || this.eventForm.capacity < 1) {
      this.showToast('Completa el nombre, lugar, fecha y una capacidad válida.');
      return;
    }
    const existing = this.editingEventId ? this.events.find((item) => item.id === this.editingEventId) : undefined;
    const event: EventRecord = {
      id: this.editingEventId ?? crypto.randomUUID(),
      title: this.eventForm.title.trim(),
      category: this.eventForm.category,
      description: this.eventForm.description.trim(),
      location: this.eventForm.location.trim(),
      startsAt: new Date(this.eventForm.startsAt).toISOString(),
      capacity: Number(this.eventForm.capacity),
      status: this.eventForm.status,
      organizer: existing?.organizer ?? this.currentUserName,
      latitude: this.eventCoordinates?.latitude,
      longitude: this.eventCoordinates?.longitude,
      createdAt: existing?.createdAt ?? new Date().toISOString()
    };
    await db.events.put(event);
    this.isEventFormOpen = false;
    await this.refreshData();
    this.showToast(this.editingEventId ? 'Evento actualizado correctamente.' : 'Evento creado correctamente.');
    this.editingEventId = null;
  }

  async deleteEvent(event: EventRecord): Promise<void> {
    if (!window.confirm(`¿Eliminar el evento "${event.title}"? Esta acción también eliminará sus registros locales.`)) return;
    await db.transaction('rw', db.events, db.registrations, db.tickets, db.attendance, async () => {
      await db.events.delete(event.id);
      await db.registrations.where('eventId').equals(event.id).delete();
      await db.tickets.where('eventId').equals(event.id).delete();
      await db.attendance.where('eventId').equals(event.id).delete();
    });
    await this.refreshData();
    this.showToast('Evento eliminado de este dispositivo.');
  }

  captureLocation(): void {
    if (!navigator.geolocation) {
      this.showToast('Este navegador no ofrece geolocalización.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.eventCoordinates = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };
        this.showToast('Ubicación capturada correctamente.');
      },
      (error) => this.showToast(`No se pudo obtener la ubicación: ${error.message}`),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async createRegistration(): Promise<void> {
    const name = this.registrationForm.attendeeName.trim();
    const email = this.registrationForm.email.trim().toLowerCase();
    const event = this.events.find((item) => item.id === this.registrationForm.eventId);
    if (!event || !name || !/^\S+@\S+\.\S+$/.test(email)) {
      this.showToast('Selecciona un evento e introduce un nombre y correo válidos.');
      return;
    }
    if (event.status !== 'published') {
      this.showToast('Este evento no está publicado y no acepta inscripciones.');
      return;
    }
    const duplicate = await db.registrations.where('[eventId+email]').equals([event.id, email]).first();
    if (duplicate && duplicate.status === 'confirmed') {
      this.showToast('Este correo ya tiene una inscripción para el evento.');
      return;
    }
    const currentCount = await db.registrations.where('eventId').equals(event.id).count();
    if (currentCount >= event.capacity) {
      this.showToast('El evento alcanzó su capacidad máxima.');
      return;
    }

    const registration: RegistrationRecord = {
      id: crypto.randomUUID(), eventId: event.id, attendeeName: name,
      email, registeredAt: new Date().toISOString(), status: 'confirmed'
    };
    const ticket: TicketRecord = {
      id: crypto.randomUUID(), eventId: event.id, registrationId: registration.id,
      attendeeName: name, attendeeEmail: email,
      code: `EP-${crypto.randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`,
      status: 'valid', createdAt: new Date().toISOString()
    };
    await db.transaction('rw', db.registrations, db.tickets, async () => {
      await db.registrations.add(registration);
      await db.tickets.add(ticket);
    });
    this.registrationForm.attendeeName = '';
    this.registrationForm.email = '';
    await this.refreshData();
    await this.showTicket(ticket);
    this.showToast('Inscripción confirmada y boleto generado.');
  }

  async showTicket(ticket: TicketRecord): Promise<void> {
    const payload: TicketQrPayload = {
      app: 'EventPass', version: 1, ticketId: ticket.id, eventId: ticket.eventId, code: ticket.code
    };
    this.ticketPreview = ticket;
    this.ticketQrDataUrl = await QRCode.toDataURL(JSON.stringify(payload), {
      width: 320, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#111827', light: '#FFFFFF' }
    });
  }

  downloadTicketQr(): void {
    if (!this.ticketQrDataUrl || !this.ticketPreview) return;
    const link = document.createElement('a');
    link.href = this.ticketQrDataUrl;
    link.download = `EventPass-${this.ticketPreview.code}.png`;
    link.click();
  }

  async startScanner(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.showToast('La cámara no está disponible. Usa localhost o HTTPS y un navegador compatible.');
      return;
    }
    if (!this.videoElement?.nativeElement) {
      this.showToast('No se encontró el área de cámara. Vuelve a abrir el escáner.');
      return;
    }
    try {
      this.reader = new BrowserMultiFormatReader();
      this.scannerActive = true;
      this.scannerMessage = 'Apunta la cámara al código QR del boleto.';
      this.scannerControls = await this.reader.decodeFromVideoDevice(
        undefined,
        this.videoElement.nativeElement,
        (result) => {
          if (result) {
            const raw = result.getText();
            this.stopScanner();
            this.scannerInput = raw;
            void this.validateTicket(raw);
          }
        }
      );
    } catch (error) {
      this.scannerActive = false;
      const message = error instanceof Error ? error.message : 'Permiso de cámara denegado.';
      this.showToast(`No se pudo iniciar la cámara: ${message}`);
    }
  }

  stopScanner(): void {
    this.scannerControls?.stop();
    this.scannerControls = null;
    this.reader = null;
    this.scannerActive = false;
  }

  async validateManualCode(): Promise<void> {
    if (!this.scannerInput.trim()) {
      this.showToast('Escribe o escanea un código QR.');
      return;
    }
    await this.validateTicket(this.scannerInput.trim());
  }

  async validateTicket(rawValue: string): Promise<void> {
    let code = rawValue.trim();
    let qrPayload: Partial<TicketQrPayload> | null = null;
    try {
      const parsed = JSON.parse(rawValue) as Partial<TicketQrPayload>;
      if (parsed.app !== 'EventPass' || parsed.version !== 1 || !parsed.code) {
        this.setScannerResult('error', 'El código QR no corresponde a un boleto EventPass válido.');
        return;
      }
      qrPayload = parsed;
      code = parsed.code;
    } catch {
      // También se permite introducir el código alfanumérico impreso en el boleto.
    }

    const ticket = await db.tickets.where('code').equals(code).first();
    if (!ticket) {
      this.setScannerResult('error', 'Boleto no encontrado en los datos disponibles de este dispositivo.');
      return;
    }
    if (qrPayload && (qrPayload.ticketId !== ticket.id || qrPayload.eventId !== ticket.eventId)) {
      this.setScannerResult('error', 'Los datos del código QR no coinciden con el boleto almacenado.');
      return;
    }
    if (ticket.status === 'cancelled') {
      this.setScannerResult('error', 'El boleto está cancelado y no permite el acceso.');
      return;
    }
    const previousAttendance = await db.attendance.where('ticketId').equals(ticket.id).first();
    if (ticket.status === 'used' || previousAttendance) {
      this.setScannerResult('warning', `Este boleto ya fue utilizado${previousAttendance ? ` el ${this.formatDate(previousAttendance.scannedAt)}` : ''}.`);
      return;
    }

    const attendance: AttendanceRecord = {
      id: crypto.randomUUID(), ticketId: ticket.id, eventId: ticket.eventId,
      attendeeName: ticket.attendeeName, scannedAt: new Date().toISOString(),
      scannerName: this.currentUserName, syncStatus: 'pending',
      deviceId: this.getDeviceId()
    };
    await db.transaction('rw', db.attendance, db.tickets, db.syncQueue, async () => {
      await db.attendance.add(attendance);
      await db.tickets.update(ticket.id, { status: 'used' });
      await db.syncQueue.add({
        recordId: attendance.id, type: 'attendance', createdAt: attendance.scannedAt, status: 'pending'
      });
    });
    await this.refreshData();
    this.setScannerResult('success', `Acceso autorizado para ${ticket.attendeeName}. El registro quedó guardado en este dispositivo.`);
    if (this.isOnline && this.cloud.isConfigured) void this.syncPending(false);
  }

  private setScannerResult(kind: 'success' | 'error' | 'warning', message: string): void {
    this.scannerResult = kind;
    this.scannerMessage = message;
  }

  private getDeviceId(): string {
    const key = 'eventpass-device-id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  }

  async syncPending(showFeedback = true): Promise<void> {
    if (!this.isOnline) {
      if (showFeedback) this.showToast('No hay conexión. Los registros seguirán pendientes.');
      return;
    }
    const pending = await db.attendance.where('syncStatus').equals('pending').toArray();
    if (!pending.length) {
      if (showFeedback) this.showToast('No hay asistencias pendientes de sincronización.');
      return;
    }
    this.isSyncing = true;
    try {
      await this.cloud.syncAttendance(pending);
      await db.transaction('rw', db.attendance, db.syncQueue, async () => {
        for (const item of pending) {
          await db.attendance.update(item.id, { syncStatus: 'synced' });
          const queueItem = await db.syncQueue.where('recordId').equals(item.id).first();
          if (queueItem?.id) await db.syncQueue.update(queueItem.id, { status: 'completed', lastError: undefined });
        }
      });
      await this.refreshData();
      if (showFeedback) this.showToast(`${pending.length} asistencia(s) sincronizada(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error de sincronización.';
      if (showFeedback) this.showToast(`No fue posible sincronizar: ${message}`);
    } finally {
      this.isSyncing = false;
    }
  }

  async signInCloud(): Promise<void> {
    try {
      await this.cloud.signIn(this.cloudEmail.trim(), this.cloudPassword);
      this.cloudSignedIn = true;
      this.cloudPassword = '';
      this.showToast('Sesión de Supabase iniciada.');
    } catch (error) {
      this.showToast(error instanceof Error ? error.message : 'No se pudo iniciar sesión.');
    }
  }

  async signOutCloud(): Promise<void> {
    try {
      await this.cloud.signOut();
      this.cloudSignedIn = false;
      this.showToast('Sesión de Supabase cerrada.');
    } catch (error) {
      this.showToast(error instanceof Error ? error.message : 'No se pudo cerrar sesión.');
    }
  }

  async requestNotifications(): Promise<void> {
    if (!('Notification' in window)) {
      this.showToast('Este navegador no admite notificaciones.');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      this.showToast('No se concedió el permiso de notificaciones.');
      return;
    }
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification('EventPass está listo', {
        body: 'Las notificaciones están activadas en este dispositivo.',
        icon: '/icons/icon-192.png', badge: '/icons/icon-192.png'
      });
    } else {
      new Notification('EventPass está listo', { body: 'Las notificaciones están activadas.' });
    }
    this.showToast('Notificaciones activadas.');
  }

  async installApp(): Promise<void> {
    if (!this.deferredInstallPrompt) {
      this.showToast('Usa el menú de instalación del navegador. En iPhone: Compartir > Agregar a pantalla de inicio.');
      return;
    }
    await this.deferredInstallPrompt.prompt();
    const choice = await this.deferredInstallPrompt.userChoice;
    if (choice.outcome === 'accepted') this.showToast('EventPass se está instalando.');
    this.deferredInstallPrompt = null;
  }

  exportAttendanceCsv(): void {
    const rows = [
      ['Evento', 'Participante', 'Fecha y hora', 'Personal', 'Sincronización'],
      ...this.attendance.map((item) => [
        this.eventTitle(item.eventId), item.attendeeName, this.formatDate(item.scannedAt),
        item.scannerName, item.syncStatus === 'synced' ? 'Sincronizado' : 'Pendiente'
      ])
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `eventpass-asistencias-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    this.showToast('Reporte CSV descargado.');
  }

  private showToast(message: string): void {
    this.toastMessage = message;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastMessage = '', 4200);
  }
}
