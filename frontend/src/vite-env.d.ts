/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend API URL */
  readonly VITE_API_URL: string;
  /** Application title */
  readonly VITE_APP_TITLE?: string;
  /** Enable analytics tracking */
  readonly VITE_ENABLE_ANALYTICS?: string;
  /** Current environment */
  readonly MODE: string;
  /** Is development mode */
  readonly DEV: boolean;
  /** Is production mode */
  readonly PROD: boolean;
  /** Server-side rendering */
  readonly SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
