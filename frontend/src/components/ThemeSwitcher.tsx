import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import './ThemeSwitcher.css';

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  return (
    <div className="theme-switcher">
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
        className="theme-select"
        title={t('theme.select')}
      >
        <option value="system">{t('theme.system')}</option>
        <option value="light">{t('theme.light')}</option>
        <option value="dark">{t('theme.dark')}</option>
      </select>
    </div>
  );
}

