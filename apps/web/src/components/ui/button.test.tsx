import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import { statusTone } from './badge';

/**
 * These assert the behaviours that protect users' money and readability,
 * not that the components render.
 */
describe('Button', () => {
  it('is unclickable while loading', () => {
    // The reason this matters: a loading button that stays clickable turns one
    // airtime purchase into three on a slow Nigerian connection.
    render(<Button loading>Buy airtime</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('is not marked busy when idle', () => {
    render(<Button>Buy airtime</Button>);
    const button = screen.getByRole('button');
    expect(button).not.toBeDisabled();
    expect(button.getAttribute('aria-busy')).toBeNull();
  });

  it('announces loading text when supplied', () => {
    render(
      <Button loading loadingText="Buying airtime…">
        Buy airtime
      </Button>,
    );
    expect(screen.getByRole('button').textContent).toContain('Buying airtime…');
  });

  it('always carries a visible focus ring', () => {
    // Removing focus styling is the most common accessibility regression, so
    // it is pinned here rather than left to review.
    render(<Button>Continue</Button>);
    expect(screen.getByRole('button').className).toContain('focus-visible:ring-2');
  });
});

describe('statusTone', () => {
  it('always returns a human label, never a raw enum', () => {
    // Status must never be communicated by colour alone. Every badge pairs its
    // tint with this word.
    const cases = ['SUCCESSFUL', 'DELIVERED', 'PENDING', 'FAILED', 'REFUNDED'];
    for (const status of cases) {
      const { label } = statusTone(status);
      expect(label).not.toBe(status);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('phrases the unknown-outcome state for the person waiting on their money', () => {
    // "REQUIRES_RECONCILIATION" is an engineering term. The user sees the state
    // their purchase is actually in.
    const { label, tone } = statusTone('REQUIRES_RECONCILIATION');
    expect(label).toBe('Confirming');
    // Info, not success and not danger — we genuinely do not know yet.
    expect(tone).toBe('info');
  });

  it('degrades gracefully for a status it has never seen', () => {
    const { label } = statusTone('SOME_NEW_STATE');
    expect(label).toBe('some new state');
  });
});
