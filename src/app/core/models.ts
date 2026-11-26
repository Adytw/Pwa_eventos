export type UserRole = 'admin' | 'organizer' | 'staff' | 'attendee';
export type EventStatus = 'draft' | 'published' | 'closed' | 'finished';
export type TicketStatus = 'valid' | 'used' | 'cancelled';
export type SyncStatus = 'pending' | 'synced';

export interface EventRecord {
  id: string;
  title: string;
  category: string;
  description: string;
  location: string;
  startsAt: string;
  capacity: number;
  status: EventStatus;
  organizer: string;
  latitude?: number;
  longitude?: number;
  createdAt: string;
}

export interface RegistrationRecord {
  id: string;
  eventId: string;
  attendeeName: string;
  email: string;
  registeredAt: string;
  status: 'confirmed' | 'cancelled';
}

export interface TicketRecord {
  id: string;
  eventId: string;
  registrationId: string;
  attendeeName: string;
  attendeeEmail: string;
  code: string;
  status: TicketStatus;
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  ticketId: string;
  eventId: string;
  attendeeName: string;
  scannedAt: string;
  scannerName: string;
  syncStatus: SyncStatus;
  deviceId: string;
}

export interface SyncQueueRecord {
  id?: number;
  recordId: string;
  type: 'attendance';
  createdAt: string;
  status: 'pending' | 'completed';
  lastError?: string;
}

export interface TicketQrPayload {
  app: 'EventPass';
  version: 1;
  ticketId: string;
  eventId: string;
  code: string;
}
