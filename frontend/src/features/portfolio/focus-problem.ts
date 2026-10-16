import { useEffect, useRef, useState } from 'react';

/**
 * After a submit refused for field problems, the focus moves to the first field marked invalid,
 * so its problem (its aria-describedby) is read out with it (portfolio-05). Put `form` on the form
 * and call `refused()` where the submit stops; the focus moves once the fields show their problems.
 */
export function useFocusFirstProblem() {
  const form = useRef<HTMLFormElement>(null);
  const [refusals, setRefusals] = useState(0);
  useEffect(() => {
    if (refusals > 0)
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')?.focus();
  }, [refusals]);
  return { form, refused: () => setRefusals((count) => count + 1) };
}
