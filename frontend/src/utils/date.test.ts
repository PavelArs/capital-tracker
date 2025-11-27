import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatShortDate,
  formatLongDate,
  timeAgo,
  relativeDate,
  smartDate,
  formatForInput,
  isValidDate,
} from './date';

describe('date utilities', () => {
  describe('formatDate', () => {
    it('should format a date string with default format', () => {
      const result = formatDate('2024-01-15');
      expect(result).toBe('15.01.2024');
    });

    it('should format a Date object', () => {
      const result = formatDate(new Date(2024, 0, 15));
      expect(result).toBe('15.01.2024');
    });

    it('should use custom format', () => {
      const result = formatDate('2024-01-15', 'yyyy-MM-dd');
      expect(result).toBe('2024-01-15');
    });

    it('should use Russian locale', () => {
      const result = formatDate('2024-01-15', 'MMMM', 'ru');
      // date-fns returns genitive case for standalone month
      expect(result).toBe('января');
    });

    it('should use English locale', () => {
      const result = formatDate('2024-01-15', 'MMMM', 'en');
      expect(result).toBe('January');
    });

    it('should return empty string for invalid date', () => {
      const result = formatDate('invalid-date');
      expect(result).toBe('');
    });
  });

  describe('formatDateTime', () => {
    it('should format date with time', () => {
      const result = formatDateTime('2024-01-15T14:30:00');
      expect(result).toBe('15.01.2024 14:30');
    });

    it('should use Russian locale', () => {
      const result = formatDateTime('2024-01-15T14:30:00', 'ru');
      expect(result).toBe('15.01.2024 14:30');
    });

    it('should return empty string for invalid date', () => {
      const result = formatDateTime('invalid');
      expect(result).toBe('');
    });
  });

  describe('formatShortDate', () => {
    it('should format date in short format', () => {
      const result = formatShortDate('2024-01-15', 'en');
      expect(result).toBe('15 Jan');
    });

    it('should format date in short format with Russian locale', () => {
      const result = formatShortDate('2024-01-15', 'ru');
      expect(result).toBe('15 янв.');
    });
  });

  describe('formatLongDate', () => {
    it('should format date in long format', () => {
      const result = formatLongDate('2024-01-15', 'en');
      expect(result).toBe('January 15, 2024');
    });

    it('should format date in long format with Russian locale', () => {
      const result = formatLongDate('2024-01-15', 'ru');
      expect(result).toContain('января');
    });
  });

  describe('timeAgo', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T12:00:00'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return time ago for past date', () => {
      const pastDate = new Date('2024-01-15T10:00:00');
      const result = timeAgo(pastDate, 'en');
      expect(result).toContain('ago');
    });

    it('should return time ago in Russian', () => {
      const pastDate = new Date('2024-01-15T10:00:00');
      const result = timeAgo(pastDate, 'ru');
      expect(result).toContain('назад');
    });

    it('should return empty string for invalid date', () => {
      const result = timeAgo('invalid');
      expect(result).toBe('');
    });
  });

  describe('relativeDate', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T12:00:00'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return relative date', () => {
      const yesterday = new Date('2024-01-14T12:00:00');
      const result = relativeDate(yesterday, 'en');
      expect(result).toContain('yesterday');
    });

    it('should return empty string for invalid date', () => {
      const result = relativeDate('invalid');
      expect(result).toBe('');
    });
  });

  describe('smartDate', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T12:00:00'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return "Today" for today', () => {
      const today = new Date('2024-01-15T10:00:00');
      const result = smartDate(today, 'en');
      expect(result).toBe('Today');
    });

    it('should return "Сегодня" for today in Russian', () => {
      const today = new Date('2024-01-15T10:00:00');
      const result = smartDate(today, 'ru');
      expect(result).toBe('Сегодня');
    });

    it('should return "Yesterday" for yesterday', () => {
      const yesterday = new Date('2024-01-14T10:00:00');
      const result = smartDate(yesterday, 'en');
      expect(result).toBe('Yesterday');
    });

    it('should return "Вчера" for yesterday in Russian', () => {
      const yesterday = new Date('2024-01-14T10:00:00');
      const result = smartDate(yesterday, 'ru');
      expect(result).toBe('Вчера');
    });

    it('should return day name for dates within last week', () => {
      const lastWeek = new Date('2024-01-10T10:00:00');
      const result = smartDate(lastWeek, 'en');
      expect(result).toBe('Wednesday');
    });

    it('should return month and day for dates this year but older than a week', () => {
      const oldDate = new Date('2024-01-01T10:00:00');
      const result = smartDate(oldDate, 'en');
      expect(result).toBe('Jan 1');
    });

    it('should return full date for dates in previous years', () => {
      const lastYear = new Date('2023-06-15T10:00:00');
      const result = smartDate(lastYear, 'en');
      expect(result).toBe('Jun 15, 2023');
    });

    it('should return empty string for invalid date', () => {
      const result = smartDate('invalid');
      expect(result).toBe('');
    });
  });

  describe('formatForInput', () => {
    it('should format date for input field', () => {
      const result = formatForInput('2024-01-15');
      expect(result).toBe('2024-01-15');
    });

    it('should format Date object for input field', () => {
      const result = formatForInput(new Date(2024, 0, 15));
      expect(result).toBe('2024-01-15');
    });
  });

  describe('isValidDate', () => {
    it('should return true for valid date string', () => {
      expect(isValidDate('2024-01-15')).toBe(true);
    });

    it('should return true for valid Date object', () => {
      expect(isValidDate(new Date())).toBe(true);
    });

    it('should return false for invalid date string', () => {
      expect(isValidDate('invalid')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidDate('')).toBe(false);
    });

    it('should return true for ISO date string', () => {
      expect(isValidDate('2024-01-15T14:30:00.000Z')).toBe(true);
    });
  });
});
