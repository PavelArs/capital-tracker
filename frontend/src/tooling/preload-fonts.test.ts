import type { IndexHtmlTransformContext } from 'vite';
import { describe, expect, it } from 'vitest';
import { preloadFonts } from './preload-fonts';

function tagsFor(files: string[]) {
  const plugin = preloadFonts();
  const hook = plugin.transformIndexHtml;
  const handler = typeof hook === 'function' || !hook ? undefined : hook.handler;
  const bundle = Object.fromEntries(files.map((file) => [file, {}]));
  return handler?.call({} as never, '', { bundle } as unknown as IndexHtmlTransformContext);
}

describe('FONT-PRELOAD', () => {
  it('announces only the Latin file of the body font, as a CORS font preload', () => {
    const tags = tagsFor([
      'assets/index-abc.js',
      'assets/onest-latin-wght-normal-Dun_Rd-l.woff2',
      'assets/onest-latin-ext-wght-normal-QAhDxQuo.woff2',
      'assets/onest-cyrillic-wght-normal-DayYxulF.woff2',
      'assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2',
    ]);
    expect(tags).toEqual([
      {
        tag: 'link',
        attrs: {
          rel: 'preload',
          as: 'font',
          type: 'font/woff2',
          crossorigin: '',
          href: '/assets/onest-latin-wght-normal-Dun_Rd-l.woff2',
        },
        injectTo: 'head',
      },
    ]);
  });

  it('adds nothing when the font is not part of the build', () => {
    expect(tagsFor(['assets/index-abc.js'])).toEqual([]);
  });
});
