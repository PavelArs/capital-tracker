import { isAxiosError } from 'axios';

export function accountingError(error: unknown, action: string): string {
  if (!isAxiosError(error)) return `Не удалось ${action}. Проверьте данные и попробуйте еще раз.`;
  const status = error.response?.status;
  if (status === 400) return 'Проверьте введенные данные и повторите попытку.';
  if (status === 404) return 'Счет или инструмент не найден. Обновите страницу.';
  if (status === 409)
    return 'Данные изменились. Загрузите актуальную версию и проверьте ее перед сохранением.';
  if (status === 401) return 'Сеанс завершен. Войдите снова.';
  if (status === 403) return 'Запрос отклонен. Обновите страницу и повторите действие.';
  if (status && status >= 500) return `Не удалось ${action}: внутренняя ошибка сервера.`;
  if (!error.response)
    return `Не удалось ${action}: проверьте подключение. Если запрос мог сохраниться, повторите его с теми же данными.`;
  return `Не удалось ${action}. Повторите попытку.`;
}

export function newRequestId(): string {
  return crypto.randomUUID();
}
