import Dexie, { Table } from 'dexie';
import {
  AttendanceRecord,
  EventRecord,
  RegistrationRecord,
  SyncQueueRecord,
  TicketRecord
} from './models';

class EventPassDatabase extends Dexie {
  events!: Table<EventRecord, string>;
  registrations!: Table<RegistrationRecord, string>;
  tickets!: Table<TicketRecord, string>;
  attendance!: Table<AttendanceRecord, string>;
  syncQueue!: Table<SyncQueueRecord, number>;

  constructor() {
    super('EventPassDB');
    this.version(1).stores({
      events: 'id, status, startsAt, title',
      registrations: 'id, eventId, email, [eventId+email], registeredAt',
      tickets: 'id, code, eventId, registrationId, status',
      attendance: 'id, ticketId, eventId, scannedAt, syncStatus',
      syncQueue: '++id, recordId, type, status, createdAt'
    });
  }
}

export const db = new EventPassDatabase();

export async function seedDemoData(): Promise<void> {
  if (await db.events.count()) return;

  const now = new Date();
  const plusDays = (days: number, hour = 10): string => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  };

  const events: EventRecord[] = [
    {
      id: crypto.randomUUID(), title: 'Tech Future 2026', category: 'Tecnología',
      description: 'Encuentro de innovación, desarrollo de software e inteligencia artificial.',
      location: 'Auditorio principal · UTGZ', startsAt: plusDays(9, 9), capacity: 180,
      status: 'published', organizer: 'Administración EventPass', createdAt: now.toISOString()
    },
    {
      id: crypto.randomUUID(), title: 'Creative Design Meetup', category: 'Diseño',
      description: 'Conferencias y talleres de diseño digital, experiencia de usuario y creatividad.',
      location: 'Centro de innovación', startsAt: plusDays(16, 11), capacity: 90,
      status: 'published', organizer: 'Administración EventPass', createdAt: now.toISOString()
    },
    {
      id: crypto.randomUUID(), title: 'Emprende Local', category: 'Emprendimiento',
      description: 'Espacio para compartir ideas, proyectos y experiencias de emprendimiento.',
      location: 'Sala de usos múltiples', startsAt: plusDays(24, 10), capacity: 120,
      status: 'draft', organizer: 'Administración EventPass', createdAt: now.toISOString()
    }
  ];
  await db.events.bulkAdd(events);

  const registrations: RegistrationRecord[] = [
    { id: crypto.randomUUID(), eventId: events[0].id, attendeeName: 'María Fernanda López', email: 'maria@example.com', registeredAt: now.toISOString(), status: 'confirmed' },
    { id: crypto.randomUUID(), eventId: events[0].id, attendeeName: 'Carlos Hernández', email: 'carlos@example.com', registeredAt: now.toISOString(), status: 'confirmed' },
    { id: crypto.randomUUID(), eventId: events[1].id, attendeeName: 'Daniela Cruz', email: 'daniela@example.com', registeredAt: now.toISOString(), status: 'confirmed' }
  ];
  await db.registrations.bulkAdd(registrations);

  const tickets: TicketRecord[] = registrations.map((registration) => ({
    id: crypto.randomUUID(), eventId: registration.eventId, registrationId: registration.id,
    attendeeName: registration.attendeeName, attendeeEmail: registration.email,
    code: `EP-${crypto.randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`,
    status: 'valid', createdAt: now.toISOString()
  }));
  await db.tickets.bulkAdd(tickets);

  // Un registro de ejemplo permite que el panel muestre actividad desde el primer inicio.
  const sampleTicket = tickets[2];
  await db.attendance.add({
    id: crypto.randomUUID(), ticketId: sampleTicket.id, eventId: sampleTicket.eventId,
    attendeeName: sampleTicket.attendeeName, scannedAt: now.toISOString(),
    scannerName: 'Personal de acceso', syncStatus: 'pending', deviceId: 'demo-device'
  });
  await db.tickets.update(sampleTicket.id, { status: 'used' });
}
