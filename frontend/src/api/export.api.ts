import apiClient from './client';

export type ExportKind = 'csv' | 'backup';

const fallbackNames: Record<ExportKind, string> = {
  csv: 'capital-tracker-export.zip',
  backup: 'capital-tracker-backup.json',
};

// M19 Settings → Data: the owner's data as a file; the server names it with the export date.
export const exportApi = {
  download: async (kind: ExportKind): Promise<{ blob: Blob; filename: string }> => {
    const response = await apiClient.get<Blob>(`/export/${kind}`, {
      responseType: 'blob',
      timeout: 120_000,
    });
    const disposition = String(response.headers['content-disposition'] ?? '');
    const named = /filename="([A-Za-z0-9._-]+)"/.exec(disposition)?.[1];
    return { blob: response.data, filename: named ?? fallbackNames[kind] };
  },
};
