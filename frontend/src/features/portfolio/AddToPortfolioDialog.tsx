import { useId } from 'react';
import Modal from '@/ui/Modal';
import CloseButton from '../shell/CloseButton';
import { Icon, type IconName } from '../shell/icons';

export type AddChoice = 'crypto' | 'bank' | 'property' | 'other';

// "Add to portfolio" from the accepted mockups (v8): pick what it is, then that class's own form.
// Broker accounts join this list once their form exists.
const choices: readonly { key: AddChoice; title: string; detail: string; icon: IconName }[] = [
  {
    key: 'crypto',
    title: 'Crypto',
    detail: 'A blockchain wallet or an exchange account. Balances and history sync by themselves.',
    icon: 'wallets',
  },
  {
    key: 'bank',
    title: 'Bank',
    detail: 'A deposit or a savings account. The app counts the interest.',
    icon: 'archive',
  },
  {
    key: 'property',
    title: 'Real estate',
    detail: 'An apartment, a house, land or parking, at your own estimate.',
    icon: 'home',
  },
  {
    key: 'other',
    title: 'Something else',
    detail: 'A coin you enter by hand, cash, or anything else whose value you set.',
    icon: 'portfolio',
  },
];

export default function AddToPortfolioDialog({
  onClose,
  onChoose,
}: {
  onClose: () => void;
  onChoose: (choice: AddChoice) => void;
}) {
  const id = useId();
  return (
    <Modal titleId={`${id}-title`} size="wide" onEscape={onClose}>
      <div className="ui-modal__head">
        <h2 id={`${id}-title`}>Add to portfolio</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="ui-modal__body">
        <p className="portfolio-add__lead">What do you want to add?</p>
        <div className="portfolio-add">
          {choices.map((choice) => (
            <button
              key={choice.key}
              type="button"
              className={`portfolio-add__choice portfolio-add__choice--${choice.key}`}
              onClick={() => onChoose(choice.key)}
            >
              <span className="portfolio-add__icon" aria-hidden="true">
                <Icon name={choice.icon} className="shell-icon shell-icon--sm" />
              </span>
              <b>{choice.title}</b>
              <small>{choice.detail}</small>
            </button>
          ))}
        </div>
        <p className="portfolio-add__note">
          Everything you add counts in one net worth, chart and allocation, in USD, EUR or RUB.
        </p>
      </div>
    </Modal>
  );
}
