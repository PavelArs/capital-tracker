import { useError } from '../contexts/ErrorContext';
import './ErrorNotification.css';

export default function ErrorNotification() {
  const { error, clearError } = useError();

  if (!error) {
    return null;
  }

  return (
    <div className="error-notification" onClick={clearError}>
      <div className="error-notification-content">
        <span className="error-icon">⚠️</span>
        <span className="error-message">{error}</span>
        <button className="error-close" onClick={clearError}>×</button>
      </div>
    </div>
  );
}

