import { useTheme } from '@contexts/ThemeContext';
import { Link } from 'react-router-dom';
import './shell-page.css';

const themeChoices = [
  ['system', 'System'],
  ['dark', 'Dark'],
  ['light', 'Light'],
] as const;

export default function SettingsPage() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div className="shell-page">
      <h1>Settings</h1>
      <div className="shell-settings">
        <section className="shell-card" aria-labelledby="settings-display">
          <h2 id="settings-display">Display</h2>
          <div className="shell-setting">
            <div className="shell-setting__text">
              <span id="settings-theme" className="shell-setting__label">
                Theme
              </span>
              <p id="settings-theme-hint" className="shell-setting__hint">
                {theme === 'system'
                  ? `Follows your device, now ${resolvedTheme}`
                  : 'Saved in this browser'}
              </p>
            </div>
            <div
              className="shell-seg"
              role="radiogroup"
              aria-labelledby="settings-theme"
              aria-describedby="settings-theme-hint"
            >
              {themeChoices.map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={theme === value}
                    onChange={() => setTheme(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </section>
        <p className="shell-note">
          Security, sessions, base currency and export arrive in later steps. Language, currencies
          and display rates are still in <Link to="/settings">Legacy settings</Link>.
        </p>
      </div>
    </div>
  );
}
