"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card } from "@/components/ui";
import { apiUrl } from "@/lib/api";

type CalendarAppointment = {
  id: string;
  patientId: string;
  patientName: string;
  scheduledAt: string;
  reason: string | null;
  status: "requested" | "confirmed" | "completed" | "cancelled";
  recurrenceRule: "weekly" | "biweekly" | "monthly" | null;
  recurrenceIndex: number | null;
  recurrenceCount: number | null;
};

function startOfWeek(d: Date): Date {
  // Monday-start week, matching how the rest of the app writes dates
  // (day/month/year, not US-style) — consistent with a Pakistan-based clinic.
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function addDays(d: Date, n: number): Date {
  const date = new Date(d.getTime());
  date.setDate(date.getDate() + n);
  return date;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function statusTone(status: CalendarAppointment["status"]): "teal" | "alert" | "sage" {
  if (status === "confirmed") return "teal";
  if (status === "cancelled") return "alert";
  return "sage";
}

export function WeekCalendar() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [appointments, setAppointments] = useState<CalendarAppointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  useEffect(() => {
    let cancelled = false;
    setAppointments(null);
    setError(null);
    (async () => {
      try {
        const params = new URLSearchParams({ start: weekStart.toISOString(), end: weekEnd.toISOString() });
        const res = await fetch(apiUrl(`/api/doctor/calendar?${params}`), { credentials: "include" });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || "Could not load the calendar.");
          return;
        }
        setAppointments(data.appointments || []);
      } catch {
        if (!cancelled) setError("Could not reach the server.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weekStart, weekEnd]);

  const byDay = useMemo(() => {
    const map = new Map<number, CalendarAppointment[]>();
    days.forEach((_, i) => map.set(i, []));
    (appointments || []).forEach((a) => {
      const scheduled = new Date(a.scheduledAt);
      const idx = days.findIndex((d) => isSameDay(d, scheduled));
      if (idx >= 0) map.get(idx)!.push(a);
    });
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    }
    return map;
  }, [appointments, days]);

  const today = new Date();
  const weekLabel = `${weekStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${addDays(weekStart, 6).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="text-sm font-medium text-ink">{weekLabel}</div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setWeekStart((w) => addDays(w, -7))}>
            ← Prev
          </Button>
          <Button variant="ghost" onClick={() => setWeekStart(startOfWeek(new Date()))}>
            Today
          </Button>
          <Button variant="secondary" onClick={() => setWeekStart((w) => addDays(w, 7))}>
            Next →
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-alert mb-4">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
        {days.map((d, i) => {
          const dayAppointments = byDay.get(i) || [];
          const isToday = isSameDay(d, today);
          return (
            <div key={i}>
              <div className={`text-xs font-medium uppercase tracking-wide mb-2 ${isToday ? "text-teal-dark" : "text-sage"}`}>
                {d.toLocaleDateString("en-GB", { weekday: "short" })}{" "}
                <span className={isToday ? "text-teal-dark" : "text-ink"}>{d.getDate()}</span>
              </div>
              <div className="space-y-2 min-h-[60px]">
                {appointments === null && <Card className="p-3 h-16 animate-pulse !bg-line/40 border-none shadow-none"><></></Card>}
                {appointments !== null && dayAppointments.length === 0 && (
                  <div className="text-xs text-sage/70 py-2">—</div>
                )}
                {dayAppointments.map((a) => (
                  <Link key={a.id} href={`/doctor/patients/${a.patientId}`}>
                    <Card className={`p-3 hover:border-teal transition-colors ${a.status === "cancelled" ? "opacity-50" : ""}`}>
                      <div className="text-xs font-medium text-ink">
                        {new Date(a.scheduledAt).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })}
                      </div>
                      <div className="text-sm text-ink truncate mt-0.5">{a.patientName}</div>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                        {a.recurrenceRule && (
                          <Badge tone="sage">
                            {a.recurrenceIndex}/{a.recurrenceCount}
                          </Badge>
                        )}
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
