import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useForm } from './useForm';

describe('useForm', () => {
  const initialValues = {
    email: '',
    password: '',
    remember: false,
  };

  describe('initial state', () => {
    it('should initialize with provided values', () => {
      const { result } = renderHook(() =>
        useForm({
          initialValues,
          onSubmit: vi.fn(),
        })
      );

      expect(result.current.values).toEqual(initialValues);
      expect(result.current.errors).toEqual({});
      expect(result.current.touched).toEqual({});
      expect(result.current.submitting).toBe(false);
      expect(result.current.isValid).toBe(true);
    });
  });

  describe('handleChange', () => {
    it('should update field value', () => {
      const { result } = renderHook(() =>
        useForm({
          initialValues,
          onSubmit: vi.fn(),
        })
      );

      act(() => {
        result.current.handleChange('email', 'test@example.com');
      });

      expect(result.current.values.email).toBe('test@example.com');
    });

    it('should clear field error when value changes', () => {
      const { result } = renderHook(() =>
        useForm({
          initialValues,
          onSubmit: vi.fn(),
        })
      );

      act(() => {
        result.current.setFieldError('email', 'Required');
      });

      expect(result.current.errors.email).toBe('Required');

      act(() => {
        result.current.handleChange('email', 'test@example.com');
      });

      expect(result.current.errors.email).toBeUndefined();
    });
  });

  describe('handleInputChange', () => {
    it('should handle text input change', () => {
      const { result } = renderHook(() =>
        useForm({
          initialValues,
          onSubmit: vi.fn(),
        })
      );

      const event = {
        target: { name: 'email', value: 'test@example.com', type: 'text' },
      } as React.ChangeEvent<HTMLInputElement>;

      act(() => {
        result.current.handleInputChange(event);
      });

      expect(result.current.values.email).toBe('test@example.com');
    });

    it('should handle checkbox input change', () => {
      const { result } = renderHook(() =>
        useForm({
          initialValues,
          onSubmit: vi.fn(),
        })
      );

      const event = {
        target: { name: 'remember', value: 'on', type: 'checkbox', checked: true },
      } as React.ChangeEvent<HTMLInputElement>;

      act(() => {
        result.current.handleInputChange(event);
      });

      expect(result.current.values.remember).toBe(true);
    });
  });

  describe('handleBlur', () => {
    it('should mark field as touched', () => {
      const { result } = renderHook(() =>
        useForm({
          initialValues,
          onSubmit: vi.fn(),
        })
      );

      act(() => {
        result.current.handleBlur('email');
      });

      expect(result.current.touched.email).toBe(true);
    });
  });

  describe('setFieldValue', () => {
    it('should set field value', () => {
      const { result } = renderHook(() =>
        useForm({
          initialValues,
          onSubmit: vi.fn(),
        })
      );

      act(() => {
        result.current.setFieldValue('email', 'new@example.com');
      });

      expect(result.current.values.email).toBe('new@example.com');
    });
  });

  describe('setFieldError', () => {
    it('should set field error', () => {
      const { result } = renderHook(() =>
        useForm({
          initialValues,
          onSubmit: vi.fn(),
        })
      );

      act(() => {
        result.current.setFieldError('email', 'Invalid email');
      });

      expect(result.current.errors.email).toBe('Invalid email');
      expect(result.current.isValid).toBe(false);
    });
  });

  describe('handleSubmit', () => {
    it('should call onSubmit when no validation errors', async () => {
      const onSubmit = vi.fn();
      const { result } = renderHook(() =>
        useForm({
          initialValues: { email: 'test@example.com', password: '123456', remember: false },
          onSubmit,
        })
      );

      const event = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handleSubmit(event);
      });

      expect(event.preventDefault).toHaveBeenCalled();
      expect(onSubmit).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: '123456',
        remember: false,
      });
    });

    it('should not call onSubmit when validation fails', async () => {
      const onSubmit = vi.fn();
      const validate = vi.fn().mockReturnValue({ email: 'Email is required' });

      const { result } = renderHook(() =>
        useForm({
          initialValues,
          validate,
          onSubmit,
        })
      );

      const event = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handleSubmit(event);
      });

      expect(validate).toHaveBeenCalled();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(result.current.errors.email).toBe('Email is required');
    });

    it('should mark all fields as touched on submit', async () => {
      const onSubmit = vi.fn();
      const { result } = renderHook(() =>
        useForm({
          initialValues,
          onSubmit,
        })
      );

      const event = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handleSubmit(event);
      });

      expect(result.current.touched.email).toBe(true);
      expect(result.current.touched.password).toBe(true);
      expect(result.current.touched.remember).toBe(true);
    });

    it('should set submitting state during async submission', async () => {
      let resolveSubmit: () => void;
      const submitPromise = new Promise<void>((resolve) => {
        resolveSubmit = resolve;
      });
      const onSubmit = vi.fn().mockImplementation(() => submitPromise);

      const { result } = renderHook(() =>
        useForm({
          initialValues,
          onSubmit,
        })
      );

      const event = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      // Start submission
      act(() => {
        result.current.handleSubmit(event);
      });

      // During submission, loading should be true
      expect(result.current.submitting).toBe(true);

      // Resolve the submission
      await act(async () => {
        resolveSubmit!();
        await submitPromise;
      });

      expect(result.current.submitting).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset form to initial values', () => {
      const { result } = renderHook(() =>
        useForm({
          initialValues,
          onSubmit: vi.fn(),
        })
      );

      act(() => {
        result.current.handleChange('email', 'test@example.com');
        result.current.setFieldError('password', 'Required');
        result.current.handleBlur('email');
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.values).toEqual(initialValues);
      expect(result.current.errors).toEqual({});
      expect(result.current.touched).toEqual({});
    });
  });

  describe('resetField', () => {
    it('should reset single field to initial value', () => {
      const { result } = renderHook(() =>
        useForm({
          initialValues,
          onSubmit: vi.fn(),
        })
      );

      act(() => {
        result.current.handleChange('email', 'test@example.com');
        result.current.setFieldError('email', 'Invalid');
        result.current.handleBlur('email');
      });

      act(() => {
        result.current.resetField('email');
      });

      expect(result.current.values.email).toBe('');
      expect(result.current.errors.email).toBeUndefined();
      expect(result.current.touched.email).toBe(false);
    });
  });
});

