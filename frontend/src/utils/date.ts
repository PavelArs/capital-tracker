import { format, parseISO, isValid, formatDistance, formatRelative, isToday, isYesterday } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

type SupportedLocale = 'ru' | 'en';

const locales: Record<SupportedLocale, Locale> = {
  ru,
  en: enUS,
};

/**
 * Get the locale object from locale string
 */
const getLocale = (locale: SupportedLocale = 'en'): Locale => {
  return locales[locale] || enUS;
};

/**
 * Parse a date string or return the Date object
 */
const parseDate = (date: string | Date): Date => {
  if (typeof date === 'string') {
    return parseISO(date);
  }
  return date;
};

/**
 * Format a date to a string with the given format
 *
 * @example
 * formatDate('2024-01-15') // '15.01.2024'
 * formatDate(new Date(), 'dd MMM yyyy', 'en') // '15 Jan 2024'
 */
export const formatDate = (
  date: string | Date,
  formatStr: string = 'dd.MM.yyyy',
  locale: SupportedLocale = 'en'
): string => {
  const parsedDate = parseDate(date);
  if (!isValid(parsedDate)) {
    return '';
  }
  return format(parsedDate, formatStr, { locale: getLocale(locale) });
};

/**
 * Format a date to include time
 *
 * @example
 * formatDateTime('2024-01-15T14:30:00') // '15.01.2024 14:30'
 */
export const formatDateTime = (
  date: string | Date,
  locale: SupportedLocale = 'en'
): string => {
  return formatDate(date, 'dd.MM.yyyy HH:mm', locale);
};

/**
 * Format a date to a short format
 *
 * @example
 * formatShortDate('2024-01-15') // '15 Jan'
 */
export const formatShortDate = (
  date: string | Date,
  locale: SupportedLocale = 'en'
): string => {
  return formatDate(date, 'dd MMM', locale);
};

/**
 * Format a date to a long format
 *
 * @example
 * formatLongDate('2024-01-15') // 'January 15, 2024'
 */
export const formatLongDate = (
  date: string | Date,
  locale: SupportedLocale = 'en'
): string => {
  return formatDate(date, 'MMMM dd, yyyy', locale);
};

/**
 * Get the relative time from a date (e.g., "2 hours ago", "in 3 days")
 *
 * @example
 * timeAgo(new Date(Date.now() - 3600000)) // '1 hour ago'
 */
export const timeAgo = (
  date: string | Date,
  locale: SupportedLocale = 'en'
): string => {
  const parsedDate = parseDate(date);
  if (!isValid(parsedDate)) {
    return '';
  }
  return formatDistance(parsedDate, new Date(), {
    addSuffix: true,
    locale: getLocale(locale),
  });
};

/**
 * Get the relative date (e.g., "yesterday", "last Friday")
 *
 * @example
 * relativeDate(new Date(Date.now() - 86400000)) // 'yesterday at 2:30 PM'
 */
export const relativeDate = (
  date: string | Date,
  locale: SupportedLocale = 'en'
): string => {
  const parsedDate = parseDate(date);
  if (!isValid(parsedDate)) {
    return '';
  }
  return formatRelative(parsedDate, new Date(), { locale: getLocale(locale) });
};

/**
 * Get a human-readable date string that adapts based on when the date is
 *
 * @example
 * smartDate(today) // 'Today'
 * smartDate(yesterday) // 'Yesterday'
 * smartDate(lastWeek) // 'Jan 8'
 * smartDate(lastYear) // 'Jan 15, 2023'
 */
export const smartDate = (
  date: string | Date,
  locale: SupportedLocale = 'en'
): string => {
  const parsedDate = parseDate(date);
  if (!isValid(parsedDate)) {
    return '';
  }

  if (isToday(parsedDate)) {
    return locale === 'ru' ? 'Сегодня' : 'Today';
  }

  if (isYesterday(parsedDate)) {
    return locale === 'ru' ? 'Вчера' : 'Yesterday';
  }

  const now = new Date();
  const diffInDays = Math.floor((now.getTime() - parsedDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffInDays < 7) {
    return formatDate(parsedDate, 'EEEE', locale); // Day name (e.g., "Monday")
  }

  if (parsedDate.getFullYear() === now.getFullYear()) {
    return formatDate(parsedDate, 'MMM d', locale); // e.g., "Jan 15"
  }

  return formatDate(parsedDate, 'MMM d, yyyy', locale); // e.g., "Jan 15, 2023"
};

/**
 * Format a date for input[type="date"] value
 *
 * @example
 * formatForInput(new Date()) // '2024-01-15'
 */
export const formatForInput = (date: string | Date): string => {
  return formatDate(date, 'yyyy-MM-dd');
};

/**
 * Check if a date string is valid
 */
export const isValidDate = (date: string | Date): boolean => {
  const parsedDate = parseDate(date);
  return isValid(parsedDate);
};

