import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CollapsibleHeader } from '../components/CollapsibleHeader';
import { useLocalStorageState } from './useLocalStorageState';

function Sections() {
  const [collapsed, setCollapsed] = useLocalStorageState('test-sections', { layouts: false });
  return (
    <CollapsibleHeader
      title="Wall Layouts"
      summary="Auto, 4 tiles"
      expanded={!collapsed.layouts}
      onToggle={() => setCollapsed((current) => ({ ...current, layouts: !current.layouts }))}
    />
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('local Admin section preferences', () => {
  it('retains collapsed state after reload/remount', () => {
    const view = render(<Sections />);
    fireEvent.click(screen.getByRole('button', { name: /Wall Layouts Auto, 4 tiles/ }));
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    view.unmount();
    render(<Sections />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });
});
