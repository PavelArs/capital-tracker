import { Link } from 'react-router-dom';
import './ManualAccounts.css';

export default function RetiredLiabilities() {
  return (
    <div className="manual-page">
      <header className="manual-page__header">
        <div>
          <h1>Раздел обязательств закрыт</h1>
          <p>Сохранённые записи не удалены.</p>
          <Link to="/manual-accounts">Перейти к ручным счетам</Link>
        </div>
      </header>
    </div>
  );
}
