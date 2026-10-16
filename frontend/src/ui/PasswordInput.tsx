import { useState } from 'react';
import { IconButton } from './IconButton';
import { Input, type InputProps } from './inputs';

/**
 * A password or secret field with an eye button that shows and hides what was typed. The button
 * names what it will do ("Show password", "Hide password") and controls the field.
 */
export function PasswordInput({
  showLabel = 'Show password',
  hideLabel = 'Hide password',
  ...rest
}: Omit<InputProps, 'type'> & { showLabel?: string; hideLabel?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="ui-pw">
      <Input {...rest} type={visible ? 'text' : 'password'} />
      <IconButton
        label={visible ? hideLabel : showLabel}
        icon={visible ? 'eyeOff' : 'eye'}
        aria-controls={rest.id}
        disabled={rest.disabled}
        onClick={() => setVisible((shown) => !shown)}
      />
    </span>
  );
}
