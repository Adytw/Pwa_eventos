import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { AttendanceRecord } from './models';

@Injectable({ providedIn: 'root' })
export class CloudService {
  private readonly client: SupabaseClient | null;

  constructor() {
    this.client = environment.supabaseUrl && environment.supabaseAnonKey
      ? createClient(environment.supabaseUrl, environment.supabaseAnonKey)
      : null;
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  async signIn(email: string, password: string): Promise<void> {
    if (!this.client) throw new Error('Primero configura la URL y la clave pública de Supabase en src/environments/environment.ts.');
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    if (!this.client) return;
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
  }

  async hasSession(): Promise<boolean> {
    if (!this.client) return false;
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    return Boolean(data.session);
  }

  async syncAttendance(records: AttendanceRecord[]): Promise<void> {
    if (!this.client) throw new Error('La sincronización en la nube requiere configurar Supabase.');
    const { data: sessionData, error: sessionError } = await this.client.auth.getSession();
    if (sessionError) throw sessionError;
    const user = sessionData.session?.user;
    if (!user) throw new Error('Inicia sesión con una cuenta de Supabase autorizada para sincronizar.');

    for (const record of records) {
      const { error } = await this.client.from('attendance').insert({
        id: record.id,
        ticket_id: record.ticketId,
        event_id: record.eventId,
        attendee_name: record.attendeeName,
        scanner_id: user.id,
        checked_in_at: record.scannedAt,
        device_id: record.deviceId
      });
      // 23505 significa que el boleto ya tiene una asistencia registrada en el servidor.
      if (error && error.code !== '23505') throw error;
    }
  }
}
