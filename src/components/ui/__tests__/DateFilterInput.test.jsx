// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import DateFilterInput from '../DateFilterInput';

describe('DateFilterInput', () => {
  afterEach(cleanup);

  it('clears with the × button', () => {
    const onChange = vi.fn();
    render(<DateFilterInput value="2026-10-01" onChange={onChange} label="Start Date" />);
    fireEvent.click(screen.getByRole('button', { name: /clear start date/i }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('notices a picker Reset that emptied the box without a change event', () => {
    const onChange = vi.fn();
    render(<DateFilterInput value="2026-10-01" onChange={onChange} label="Start Date" />);
    const input = screen.getByLabelText('Start Date');
    input.value = ''; // what iOS Reset does: no change event fires
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('shows no clear button when empty', () => {
    render(<DateFilterInput value="" onChange={() => {}} label="End Date" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
