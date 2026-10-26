"use client";

import { useRef, useState } from "react";
import { atLocal, formatTime, zoned } from "./tz";
import type { CalendarEvent } from "./types";

export type Column = { key: string; day: string; staffId?: string; label: React.ReactNode };
export type Placed = { event: CalendarEvent; column: number; top: number; height: number; lane: number; lanes: number; startMin: number; endMin: number };
export type DropTarget = { event: CalendarEvent; day: string; minutes: number; staffId?: string };

const HOUR_PX = 56;
const PX_PER_MIN = HOUR_PX / 60;

/** Side-by-side lanes for overlapping events in one column (they're for different technicians). */
function pack(items: Omit<Placed, "lane" | "lanes">[]): Placed[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((p) => p.lane + 1));
    for (const p of cluster) out.push({ ...p, lanes });
    cluster = [];
  };
  for (const item of sorted) {
    if (item.startMin >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((p) => p.endMin > item.startMin).map((p) => p.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ ...item, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  if (cluster.length) flush();
  return out;
}

export function placeEvents(events: CalendarEvent[], columns: Column[], tz: string, firstHour: number, lastHour: number): Placed[] {
  const items: Omit<Placed, "lane" | "lanes">[] = [];
  columns.forEach((col, column) => {
    const dayStart = atLocal(col.day, 0, tz).getTime();
    for (const event of events) {
      if (col.staffId && event.staff_id !== col.staffId) continue;
      const start = new Date(event.start).getTime();
      const end = new Date(event.end).getTime();
      const startMin = Math.max(firstHour * 60, Math.round((start - dayStart) / 60000));
      const endMin = Math.min(lastHour * 60, Math.round((end - dayStart) / 60000));
      if (endMin <= firstHour * 60 || startMin >= lastHour * 60 || endMin <= startMin) continue;
      items.push({
        event, column, startMin, endMin,
        top: (startMin - firstHour * 60) * PX_PER_MIN,
        height: Math.max(18, (endMin - startMin) * PX_PER_MIN),
      });
    }
  });
  const byColumn = new Map<number, typeof items>();
  for (const i of items) byColumn.set(i.column, [...(byColumn.get(i.column) ?? []), i]);
  return [...byColumn.values()].flatMap(pack);
}

type Props = {
  columns: Column[];
  events: CalendarEvent[];
  tz: string;
  granularity: number;
  firstHour: number;
  lastHour: number;
  colorFor: (event: CalendarEvent) => string;
  canEdit: boolean;
  onEventClick: (event: CalendarEvent) => void;
  onSlotClick: (column: Column, minutes: number) => void;
  onDrop: (target: DropTarget) => void;
};

export function TimeGrid({ columns, events, tz, granularity, firstHour, lastHour, colorFor, canEdit, onEventClick, onSlotClick, onDrop }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean; column: number } | null>(null);
  const [ghost, setGhost] = useState<{ id: string; deltaMin: number; column: number } | null>(null);
  const placed = placeEvents(events, columns, tz, firstHour, lastHour);
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
  const nowZoned = zoned(new Date(), tz);
  const height = (lastHour - firstHour) * HOUR_PX;

  function columnAt(clientX: number): number {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(columns.length - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * columns.length)));
  }

  function snap(minutes: number): number {
    return Math.round(minutes / granularity) * granularity;
  }

  function onPointerDown(e: React.PointerEvent, p: Placed) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const draggable = canEdit && p.event.kind === "booking" && p.event.status === "confirmed";
    drag.current = { id: p.event.id, x: e.clientX, y: e.clientY, moved: false, column: p.column };
    if (draggable) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent, p: Placed) {
    const d = drag.current;
    if (!d || d.id !== p.event.id || !(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    if (!d.moved && Math.abs(e.clientY - d.y) < 4 && Math.abs(e.clientX - d.x) < 4) return;
    d.moved = true;
    setGhost({ id: p.event.id, deltaMin: snap((e.clientY - d.y) / PX_PER_MIN), column: columnAt(e.clientX) });
  }

  function onPointerUp(e: React.PointerEvent, p: Placed) {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== p.event.id) return;
    if (!d.moved) {
      setGhost(null);
      onEventClick(p.event);
      return;
    }
    const g = { deltaMin: snap((e.clientY - d.y) / PX_PER_MIN), column: columnAt(e.clientX) };
    setGhost(null);
    const col = columns[g.column];
    const startMin = Math.round((new Date(p.event.start).getTime() - atLocal(columns[p.column].day, 0, tz).getTime()) / 60000);
    if (g.deltaMin === 0 && g.column === p.column) return;
    onDrop({ event: p.event, day: col.day, minutes: startMin + g.deltaMin, staffId: col.staffId });
  }

  function onGridClick(e: React.MouseEvent<HTMLDivElement>, column: Column) {
    if (!canEdit) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = firstHour * 60 + Math.floor((e.clientY - rect.top) / PX_PER_MIN / granularity) * granularity;
    onSlotClick(column, minutes);
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <div style={{ minWidth: Math.max(480, 56 + columns.length * (columns.length > 7 ? 140 : 96)) }}>
        <div className="sticky top-0 z-20 flex border-b border-border bg-background">
          <div className="w-14 shrink-0" />
          {columns.map((c) => (
            <div key={c.key} className="min-w-0 flex-1 border-l border-border px-2 py-2 text-center text-xs font-medium">
              {c.label}
            </div>
          ))}
        </div>
        <div className="flex">
          <div className="relative w-14 shrink-0" style={{ height }}>
            {hours.map((h) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-muted" style={{ top: (h - firstHour) * HOUR_PX }}>
                {h === firstHour ? "" : `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`}
              </div>
            ))}
          </div>
          <div ref={gridRef} className="relative flex flex-1" style={{ height }}>
            {columns.map((c) => (
              <div
                key={c.key}
                className="relative min-w-0 flex-1 border-l border-border"
                onClick={(e) => onGridClick(e, c)}
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${HOUR_PX}px)`,
                  cursor: canEdit ? "copy" : "default",
                }}
                aria-label={`${c.key} time grid`}
              >
                {c.day === nowZoned.day && nowZoned.minutes >= firstHour * 60 && nowZoned.minutes < lastHour * 60 && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-critical" style={{ top: (nowZoned.minutes - firstHour * 60) * PX_PER_MIN }}>
                    <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-critical" />
                  </div>
                )}
              </div>
            ))}
            {placed.map((p) => {
              const moving = ghost?.id === p.event.id ? ghost : null;
              const column = moving ? moving.column : p.column;
              const width = 100 / columns.length;
              const laneWidth = width / p.lanes;
              const color = colorFor(p.event);
              const isOff = p.event.kind !== "booking";
              const held = p.event.status === "held";
              const muted = p.event.status === "completed" || p.event.status === "canceled";
              const startLabel = formatTime(new Date(new Date(p.event.start).getTime() + (moving?.deltaMin ?? 0) * 60000), tz);
              return (
                <div
                  key={`${p.event.id}-${p.column}`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onEventClick(p.event)}
                  onPointerDown={(e) => onPointerDown(e, p)}
                  onPointerMove={(e) => onPointerMove(e, p)}
                  onPointerUp={(e) => onPointerUp(e, p)}
                  onClick={(e) => e.stopPropagation()}
                  className={`absolute z-[5] select-none overflow-hidden rounded-md border px-1.5 py-0.5 text-[11px] leading-tight shadow-sm ${
                    moving ? "z-30 opacity-80 ring-2 ring-accent" : ""
                  } ${muted ? "opacity-50" : ""} ${p.event.status === "canceled" ? "line-through" : ""}`}
                  style={{
                    top: p.top + (moving?.deltaMin ?? 0) * PX_PER_MIN,
                    height: p.height - 2,
                    left: `calc(${column * width + (moving ? 0 : p.lane * laneWidth)}% + 2px)`,
                    width: `calc(${moving ? width : laneWidth}% - 4px)`,
                    background: isOff
                      ? "repeating-linear-gradient(45deg, var(--surface), var(--surface) 6px, var(--background) 6px, var(--background) 12px)"
                      : `color-mix(in srgb, ${color} ${held ? 8 : 16}%, var(--background))`,
                    borderColor: isOff ? "var(--border)" : color,
                    borderStyle: held ? "dashed" : "solid",
                    borderLeftWidth: p.event.urgency === "emergency" ? 4 : 1,
                    borderLeftColor: p.event.urgency === "emergency" ? "var(--status-critical)" : undefined,
                    cursor: canEdit && p.event.status === "confirmed" ? "grab" : "pointer",
                    touchAction: "none",
                  }}
                  title={`${p.event.title}${p.event.service_name ? ` · ${p.event.service_name}` : ""}`}
                >
                  <div className="truncate font-medium">
                    {p.event.external_change && <span title="Changed in an external calendar">⚠ </span>}
                    {p.event.rescheduled && <span title="Rescheduled">↻ </span>}
                    {p.event.title}
                  </div>
                  {!isOff && p.height > 30 && (
                    <div className="truncate text-muted">
                      {startLabel}
                      {p.event.service_name ? ` · ${p.event.service_name}` : ""}
                    </div>
                  )}
                  {held && p.height > 44 && <div className="truncate text-muted">On hold (caller on the line)</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
