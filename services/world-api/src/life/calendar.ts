import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CalendarDate, LifeCatalog } from "./types.js";

const CATALOG_FILE = "game/data/life/life_catalog.json";
const MILLISECONDS_PER_GAME_MINUTE = 60_000;
const MILLISECONDS_PER_GAME_DAY = 86_400_000;
let cachedCatalog: LifeCatalog | null = null;

function repositoryRoot(): string {
  let candidate = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 8; index += 1) {
    if (existsSync(join(candidate, CATALOG_FILE))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`Could not locate ${CATALOG_FILE}; the life catalog is required.`);
}

export function loadLifeCatalog(): LifeCatalog {
  if (cachedCatalog) return cachedCatalog;
  const parsed: unknown = JSON.parse(readFileSync(join(repositoryRoot(), CATALOG_FILE), "utf8"));
  if (
    typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).schema_version !== 1 ||
    (parsed as Record<string, unknown>).world_id !== "nigeria-main"
  ) {
    throw new Error("Life catalog is invalid or belongs to another world.");
  }
  const catalog = parsed as LifeCatalog;
  if (
    !Array.isArray(catalog.life_stages) || catalog.life_stages.length === 0 ||
    catalog.life_stages.some((stage) =>
      !stage.id || !stage.label || !Number.isSafeInteger(stage.min_age_years) ||
      !Number.isSafeInteger(stage.max_age_years) || stage.min_age_years < 0 ||
      stage.max_age_years < stage.min_age_years || typeof stage.adult_relationships_allowed !== "boolean"
    ) ||
    !Number.isFinite(catalog.calendar.real_milliseconds_per_game_minute) ||
    catalog.calendar.real_milliseconds_per_game_minute <= 0 ||
    !isValidDate(catalog.calendar.epoch_world_date) ||
    catalog.life_stages[0]?.min_age_years !== 0 ||
    !catalog.life_stages.some((stage) => stage.id === "elderly" && stage.max_age_years >= 120) ||
    !Array.isArray(catalog.family_generation?.starter_household_profiles) ||
    catalog.family_generation.starter_household_profiles.length === 0 ||
    catalog.family_generation.starter_household_profiles.some((
      profile: LifeCatalog["family_generation"]["starter_household_profiles"][number],
    ) =>
      !profile.id || !Array.isArray(profile.caregiver_roles) ||
      profile.caregiver_roles.length < 1 || profile.caregiver_roles.length > 4 ||
      profile.caregiver_roles.some((role) => role !== "parent" && role !== "guardian") ||
      !Number.isSafeInteger(profile.sibling_count) || profile.sibling_count < 1 || profile.sibling_count > 4
    )
  ) {
    throw new Error("Life catalog contains an invalid calendar or life-stage range.");
  }
  for (let index = 1; index < catalog.life_stages.length; index += 1) {
    const previous = catalog.life_stages[index - 1];
    const next = catalog.life_stages[index];
    if (!previous || !next || next.min_age_years !== previous.max_age_years + 1) {
      throw new Error("Life-stage ranges must be ordered, contiguous, and non-overlapping.");
    }
  }
  cachedCatalog = catalog;
  return catalog;
}

export interface WorldClockState {
  day: number;
  minute_of_day: number;
  millisecond_of_minute: number;
  world_date: CalendarDate;
  updated_at: string;
}

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isValidDate(value: unknown): value is CalendarDate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const date = value as Partial<CalendarDate>;
  return Number.isSafeInteger(date.year) && (date.year ?? 0) >= 1 && (date.year ?? 0) <= 9999 &&
    Number.isSafeInteger(date.month) && (date.month ?? 0) >= 1 && (date.month ?? 0) <= 12 &&
    Number.isSafeInteger(date.day) && (date.day ?? 0) >= 1 &&
    (date.day ?? 0) <= daysInMonth(date.year ?? 0, date.month ?? 0);
}

export function compareDates(left: CalendarDate, right: CalendarDate): number {
  return left.year - right.year || left.month - right.month || left.day - right.day;
}

function utcMilliseconds(date: CalendarDate): number {
  // Date.UTC treats years 0–99 as 1900–1999; setUTCFullYear preserves proleptic Gregorian years.
  const timestamp = new Date(0);
  timestamp.setUTCFullYear(date.year, date.month - 1, date.day);
  return timestamp.getTime();
}

function dateFromUtcMilliseconds(milliseconds: number): CalendarDate {
  const date = new Date(milliseconds);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  if (!isValidDate(date) || !Number.isSafeInteger(days)) throw new Error("invalid_calendar_date");
  const result = dateFromUtcMilliseconds(utcMilliseconds(date) + days * MILLISECONDS_PER_GAME_DAY);
  if (!isValidDate(result)) throw new Error("calendar_date_out_of_range");
  return result;
}

export function addYearsClamped(date: CalendarDate, years: number): CalendarDate {
  if (!isValidDate(date) || !Number.isSafeInteger(years)) throw new Error("invalid_calendar_date");
  const year = date.year + years;
  if (year < 1 || year > 9999) throw new Error("calendar_date_out_of_range");
  return { year, month: date.month, day: Math.min(date.day, daysInMonth(year, date.month)) };
}

export function birthdayDateForYear(dateOfBirth: CalendarDate, year: number): CalendarDate {
  if (!isValidDate(dateOfBirth) || !Number.isSafeInteger(year) || year < dateOfBirth.year || year > 9999) {
    throw new Error("invalid_birthday_year");
  }
  return {
    year,
    month: dateOfBirth.month,
    day: Math.min(dateOfBirth.day, daysInMonth(year, dateOfBirth.month)),
  };
}

export function ageOnDate(dateOfBirth: CalendarDate, currentDate: CalendarDate): number {
  if (!isValidDate(dateOfBirth) || !isValidDate(currentDate) || compareDates(dateOfBirth, currentDate) > 0) {
    throw new Error("invalid_date_of_birth");
  }
  let age = currentDate.year - dateOfBirth.year;
  if (compareDates(currentDate, birthdayDateForYear(dateOfBirth, currentDate.year)) < 0) age -= 1;
  return age;
}

export function dateForWorldDay(day: number, catalog: LifeCatalog = loadLifeCatalog()): CalendarDate {
  if (!Number.isSafeInteger(day) || day < catalog.calendar.starting_world_day) {
    throw new Error("invalid_world_day");
  }
  return addDays(catalog.calendar.epoch_world_date, day - catalog.calendar.starting_world_day);
}

export function worldDayForDate(date: CalendarDate, catalog: LifeCatalog = loadLifeCatalog()): number {
  if (!isValidDate(date) || compareDates(date, catalog.calendar.epoch_world_date) < 0) {
    throw new Error("calendar_date_before_world_epoch");
  }
  return Math.floor((utcMilliseconds(date) - utcMilliseconds(catalog.calendar.epoch_world_date)) /
    MILLISECONDS_PER_GAME_DAY) + catalog.calendar.starting_world_day;
}

export function dateOfBirthForAge(
  currentDate: CalendarDate,
  age: number,
  seed: string,
): CalendarDate {
  if (!isValidDate(currentDate) || !Number.isSafeInteger(age) || age < 0 || age > 9998) {
    throw new Error("invalid_age");
  }
  const seedHash = createStableHash(seed);
  const offsetDays = seedHash % 365;
  return addDays(addYearsClamped(currentDate, -age), -offsetDays);
}

export function ageForNewCharacter(
  currentDate: CalendarDate,
  age: number,
  seed: string,
  catalog: LifeCatalog = loadLifeCatalog(),
): CalendarDate {
  if (!catalog.starting_character_ages.includes(age)) throw new Error("invalid_starting_age");
  return dateOfBirthForAge(currentDate, age, seed);
}

function createStableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function lifeStageForAge(age: number, catalog: LifeCatalog = loadLifeCatalog()) {
  if (!Number.isSafeInteger(age) || age < 0) throw new Error("invalid_age");
  return catalog.life_stages.find((stage) => age >= stage.min_age_years && age <= stage.max_age_years) ??
    catalog.life_stages[catalog.life_stages.length - 1]!;
}

export function isAdultAge(age: number, catalog: LifeCatalog = loadLifeCatalog()): boolean {
  if (age < catalog.relationship_rules.minimum_adult_age_years) return false;
  return lifeStageForAge(age, catalog).adult_relationships_allowed;
}

export function calendarDateLabel(date: CalendarDate, catalog: LifeCatalog = loadLifeCatalog()): string {
  if (!isValidDate(date)) return "Unknown date";
  const month = catalog.calendar.month_names[date.month - 1] ?? String(date.month);
  return `${date.day} ${month} ${date.year}`;
}

export function weekdayForDate(date: CalendarDate, catalog: LifeCatalog = loadLifeCatalog()): string {
  if (!isValidDate(date)) return "Unknown day";
  return catalog.calendar.weekday_names[new Date(utcMilliseconds(date)).getUTCDay()] ?? "Unknown day";
}

export function weekForWorldDay(day: number, catalog: LifeCatalog = loadLifeCatalog()): number {
  if (!Number.isSafeInteger(day) || day < catalog.calendar.starting_world_day) return 0;
  const configuredStart = catalog.calendar.weekday_names.indexOf(catalog.calendar.week_starts_on);
  const startWeekday = configuredStart >= 0 ? configuredStart : 0;
  const epochWeekday = new Date(utcMilliseconds(catalog.calendar.epoch_world_date)).getUTCDay();
  const firstWeekOffset = (epochWeekday - startWeekday + 7) % 7;
  return Math.floor((day - catalog.calendar.starting_world_day + firstWeekOffset) / 7) + 1;
}

export function normalizeWorldClock(value: unknown, now: number, catalog: LifeCatalog = loadLifeCatalog()): WorldClockState {
  const record = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const day = Number.isSafeInteger(record.day) && (record.day as number) >= catalog.calendar.starting_world_day
    ? record.day as number : catalog.calendar.starting_world_day;
  const minuteOfDay = Number.isSafeInteger(record.minute_of_day) && (record.minute_of_day as number) >= 0 &&
    (record.minute_of_day as number) < 1440
    ? record.minute_of_day as number : catalog.calendar.starting_minute_of_day;
  const millisecondOfMinute = Number.isSafeInteger(record.millisecond_of_minute) &&
    (record.millisecond_of_minute as number) >= 0 &&
    (record.millisecond_of_minute as number) < MILLISECONDS_PER_GAME_MINUTE
    ? record.millisecond_of_minute as number : 0;
  const updatedAt = typeof record.updated_at === "string" && Number.isFinite(Date.parse(record.updated_at))
    ? record.updated_at : new Date(now).toISOString();
  return {
    day,
    minute_of_day: minuteOfDay,
    millisecond_of_minute: millisecondOfMinute,
    world_date: dateForWorldDay(day, catalog),
    updated_at: updatedAt,
  };
}

export function worldClockSnapshot(clock: WorldClockState, catalog: LifeCatalog = loadLifeCatalog()) {
  const secondsInDay = clock.minute_of_day * 60 + Math.floor(clock.millisecond_of_minute / 1000);
  const hour = Math.floor(secondsInDay / 3600);
  const minute = Math.floor((secondsInDay % 3600) / 60);
  const second = secondsInDay % 60;
  return {
    ...clock,
    world_date: { ...clock.world_date },
    year: clock.world_date.year,
    month: clock.world_date.month,
    date: clock.world_date.day,
    weekday: weekdayForDate(clock.world_date, catalog),
    week: weekForWorldDay(clock.day, catalog),
    hour,
    minute,
    second,
    time_label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`,
  };
}
