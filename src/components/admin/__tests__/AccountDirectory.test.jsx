// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AccountDirectory from '../AccountDirectory';

const accounts = Array.from({ length: 12 }, (_, i) => ({ id: i, full_name: `Engineer ${i + 1}`, email: `eng${i + 1}@da.gov.ph` }));
const renderList = () => render(
  <AccountDirectory
    items={accounts}
    noun="field engineer"
    searchText={(a) => `${a.full_name} ${a.email}`}
    renderItem={(a) => <p key={a.id}>{a.full_name}</p>}
  />,
);

describe('AccountDirectory', () => {
  afterEach(cleanup);

  it('shows one page at a time', () => {
    renderList();
    expect(screen.getByText('Engineer 1')).toBeTruthy();
    expect(screen.queryByText('Engineer 6')).toBeNull(); // page 2
  });

  it('searches across all pages', () => {
    renderList();
    fireEvent.change(screen.getByLabelText('Search field engineers'), { target: { value: 'eng11@' } });
    expect(screen.getByText('Engineer 11')).toBeTruthy();
    expect(screen.queryByText('Engineer 1')).toBeNull();
  });

  it('says when nothing matches', () => {
    renderList();
    fireEvent.change(screen.getByLabelText('Search field engineers'), { target: { value: 'zzz' } });
    expect(screen.getByText(/No field engineers match/)).toBeTruthy();
  });
});
