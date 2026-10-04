// Shared minimal-but-faithful schema for repo-level tests that exercise the
// clinical flow (bookings, records, RAG chunks, notifications). Mirrors the
// CREATE TABLE blocks in scripts/seed.js; db.ts's own idempotent migrations
// layer anything this schema leaves out (e.g. columns added by later
// migrations run automatically against the test file).
export function createClinicalSchema(db: {
  exec: (sql: string) => void;
}): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hospitals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT,
      province TEXT
    );
    CREATE TABLE IF NOT EXISTS doctors (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      license_number TEXT UNIQUE NOT NULL,
      specialization TEXT,
      hospital_id TEXT REFERENCES hospitals(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      national_id TEXT UNIQUE NOT NULL,
      id_type TEXT NOT NULL DEFAULT 'cnic',
      full_name TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      gender TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      email TEXT,
      address TEXT,
      blood_group TEXT NOT NULL DEFAULT 'unknown',
      allergies TEXT,
      chronic_conditions TEXT,
      weight_kg REAL,
      pediatrician_name TEXT,
      pediatrician_phone TEXT,
      guardian_patient_id TEXT REFERENCES patients(id),
      password_hash TEXT,
      emergency_qr_token TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS emergency_contacts (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      relationship_type TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS medical_records (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      doctor_id TEXT REFERENCES doctors(id),
      record_type TEXT NOT NULL DEFAULT 'checkup',
      visit_date TEXT NOT NULL,
      diagnosis TEXT,
      symptoms TEXT,
      notes TEXT,
      systolic_bp INTEGER,
      diastolic_bp INTEGER,
      blood_sugar_mmol REAL,
      body_temp_c REAL,
      heart_rate_bpm INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
      scheduled_at TEXT,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','completed','cancelled')),
      doctor_notes TEXT,
      reminder_sent_at TEXT,
      recurrence_group_id TEXT,
      recurrence_rule TEXT,
      recurrence_index INTEGER,
      recurrence_count INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS patient_registrations (
      id TEXT PRIMARY KEY,
      national_id TEXT NOT NULL,
      full_name TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      gender TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      email TEXT,
      address TEXT,
      blood_group TEXT NOT NULL DEFAULT 'unknown',
      allergies TEXT,
      chronic_conditions TEXT,
      weight_kg REAL,
      pediatrician_name TEXT,
      pediatrician_phone TEXT,
      doctor_id TEXT NOT NULL REFERENCES doctors(id),
      reason TEXT,
      contacts TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      patient_id TEXT REFERENCES patients(id),
      matched_patient_id TEXT REFERENCES patients(id),
      appointment_id TEXT REFERENCES appointments(id),
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS registration_attachments (
      id TEXT PRIMARY KEY,
      registration_id TEXT NOT NULL REFERENCES patient_registrations(id) ON DELETE CASCADE,
      stored_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS rag_chunks (
      id TEXT PRIMARY KEY,
      patient_id TEXT REFERENCES patients(id) ON DELETE CASCADE,
      registration_id TEXT REFERENCES patient_registrations(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK (source_type IN ('profile','visit','attachment')),
      source_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL DEFAULT 0,
      label TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      embedding_model TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_patient ON rag_chunks(patient_id);
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_registration ON rag_chunks(registration_id);
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_source ON rag_chunks(source_type, source_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(chunk_id UNINDEXED, content);
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'system' CHECK (type IN ('report','system')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_patient ON notifications(patient_id, is_read, created_at DESC);
    CREATE TABLE IF NOT EXISTS prescriptions (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      doctor_id TEXT REFERENCES doctors(id),
      medical_record_id TEXT REFERENCES medical_records(id),
      medications TEXT NOT NULL,
      instructions TEXT,
      issued_date TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_id);
  `);
}
