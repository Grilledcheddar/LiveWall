import { cleanup, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Button, type ButtonVariant } from './Button';

const BUTTON_VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'destructive', 'ghost'];

afterEach(cleanup);

describe('LiveWall Button', () => {
  it.each(BUTTON_VARIANTS)('marks the %s variant explicitly', (variant) => {
    render(<Button variant={variant}>{variant}</Button>);
    const button = screen.getByRole('button', { name: variant });
    expect(button).toHaveClass('lw-button', `lw-button--${variant}`);
    expect(button).not.toBeDisabled();
  });

  it('derives the disabled appearance only from real disabled semantics', () => {
    render(
      <>
        <Button variant="secondary">Enabled</Button>
        <Button variant="secondary" disabled>
          Native disabled
        </Button>
        <Button variant="secondary" aria-disabled="true">
          ARIA disabled
        </Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Enabled' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Native disabled' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ARIA disabled' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Enabled' }).className).not.toContain('disabled');
  });
});

describe('application button policy', () => {
  it('routes every application action through Button with an approved explicit variant', () => {
    const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const files: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) files.push(path);
      }
    };
    visit(sourceRoot);

    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (!file.endsWith(`${join('components', 'Button.tsx')}`) && /<button\b/.test(source))
        violations.push(`${relative(sourceRoot, file)} contains a native <button>`);
      for (const match of source.matchAll(/<Button\b[\s\S]*?>/g)) {
        if (!/\bvariant=/.test(match[0]))
          violations.push(`${relative(sourceRoot, file)} has <Button> without variant`);
      }
    }

    expect(violations).toEqual([]);
  });
});
