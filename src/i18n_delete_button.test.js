/**
 * @vitest-environment jsdom
 *
 * Tests for i18n translations related to the delete button.
 */
import { describe, it, expect } from 'vitest';
import { t, setLanguage } from './i18n.js';

describe('Delete Button i18n', () => {
  it('has German translation for deleteSelected', () => {
    setLanguage('de');
    const translation = t('planning.deleteSelected');
    expect(translation).toBe('Auswahl löschen');
  });

  it('has English translation for deleteSelected', () => {
    setLanguage('en');
    const translation = t('planning.deleteSelected');
    expect(translation).toBe('Delete selected');
  });

  it('translation key exists in both languages', () => {
    setLanguage('de');
    const de = t('planning.deleteSelected');

    setLanguage('en');
    const en = t('planning.deleteSelected');

    // Both should return actual translations, not the key itself
    expect(de).not.toBe('planning.deleteSelected');
    expect(en).not.toBe('planning.deleteSelected');

    // They should be different (German vs English)
    expect(de).not.toBe(en);
  });
});
