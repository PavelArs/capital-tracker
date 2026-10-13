import type { HtmlTagDescriptor, Plugin } from 'vite';

// FONT-PRELOAD: the stylesheet names the fonts, so the browser learns of them only after the
// stylesheet has arrived and the first text needs one. The body font's Latin file is announced in
// the page itself, so it is fetched together with the stylesheet and the text does not appear in
// a fallback font first. Other scripts (Cyrillic, symbols) and the monospace font stay on demand.
const PRELOADED = /(^|\/)onest-latin-wght-normal-[\w-]+\.woff2$/;

export function preloadFonts(): Plugin {
  return {
    name: 'preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        const tags: HtmlTagDescriptor[] = Object.keys(context.bundle ?? {})
          .filter((file) => PRELOADED.test(file))
          .map((file) => ({
            tag: 'link',
            attrs: {
              rel: 'preload',
              as: 'font',
              type: 'font/woff2',
              // Fonts are fetched in anonymous CORS mode: without this the preload is wasted.
              crossorigin: '',
              href: `/${file}`,
            },
            injectTo: 'head' as const,
          }));
        return tags;
      },
    },
  };
}
