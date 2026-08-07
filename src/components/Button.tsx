import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: ButtonVariant;
}

/**
 * The canonical LiveWall application action. Disabled is a real control state,
 * expressed only through `disabled` or `aria-disabled="true"`, never a visual variant.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, className, type = 'button', ...props },
  ref,
) {
  const classes = ['lw-button', `lw-button--${variant}`, className].filter(Boolean).join(' ');

  return <button ref={ref} type={type} className={classes} {...props} />;
});
