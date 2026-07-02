import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { LocalizationContext } from '../../contexts/LocalizationContext';
import { useAuth } from '../../contexts/AuthContext';
import { useLocalization } from '../../hooks/useLocalization';
import * as localizationService from '../../services/localizationService';
import { useLocalizationStore } from '../../stores/useLocalizationStore';

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../services/localizationService', () => ({
  getLocalization: jest.fn(),
  updateLocalization: jest.fn(),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockGetLocalization = localizationService.getLocalization as jest.MockedFunction<typeof localizationService.getLocalization>;

function LocalizationProbe({ label }: { label: string }) {
  const { locale } = useLocalization();
  return <div>{`${label}:${locale}`}</div>;
}

describe('useLocalization bootstrap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    useLocalizationStore.getState().resetAll();

    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      accessToken: null,
      isLoading: false,
      sessionStatus: 'guest',
    } as any);

    mockGetLocalization.mockResolvedValue('en');
  });

  test('applies the shared locale bootstrap only once across concurrent consumers', async () => {
    const setLocale = jest.fn();

    render(
      <LocalizationContext.Provider value={{ locale: 'fr', setLocale, t: (key) => key }}>
        <LocalizationProbe label="first" />
        <LocalizationProbe label="second" />
      </LocalizationContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText('first:en')).toBeInTheDocument();
      expect(screen.getByText('second:en')).toBeInTheDocument();
    });

    expect(mockGetLocalization).toHaveBeenCalledTimes(1);
    expect(setLocale).toHaveBeenCalledTimes(1);
    expect(setLocale).toHaveBeenCalledWith('en');
    expect(useLocalizationStore.getState().locale).toBe('en');
    expect(useLocalizationStore.getState().isInitialized).toBe(true);
  });
});