import { useId, useState } from 'react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import Modal, { ModalBody, ModalFooter, ModalHeader } from '@/ui/Modal';
import { OptionGrid, OptionTile } from '@/ui/OptionTile';
import { Icon, type IconName } from '../shell/icons';

export type AddChoice = 'crypto' | 'bank' | 'broker' | 'property' | 'other';

// "Add to portfolio" from the accepted mockups (v8): pick what it is, then that class's own form.
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
    icon: 'bank',
  },
  {
    key: 'broker',
    title: 'Broker',
    detail: 'Stocks, bonds and funds at a broker. Prices by hand for now.',
    icon: 'briefcase',
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
  // Step 1 of 2 (prototype): a tile is chosen first, Continue opens that kind's own form.
  const [chosen, setChosen] = useState<AddChoice | null>(null);
  return (
    <Modal titleId={`${id}-title`} size="wide" onEscape={onClose}>
      <ModalHeader
        titleId={`${id}-title`}
        title="Add to portfolio"
        onClose={onClose}
        steps={{ current: 1, total: 2 }}
      />
      <ModalBody>
        <p id={`${id}-lead`} className="ui-soft portfolio-add__lead">
          What do you want to add?
        </p>
        <OptionGrid layout="tile" labelledBy={`${id}-lead`}>
          {choices.map((choice, index) => (
            <OptionTile
              key={choice.key}
              pressed={chosen === choice.key}
              onClick={() => setChosen(choice.key)}
              icon={
                <span className={`portfolio-add__icon portfolio-add__icon--${choice.key}`}>
                  <Icon name={choice.icon} className="shell-icon shell-icon--sm" />
                </span>
              }
              title={choice.title}
              description={choice.detail}
              // The last tile takes the whole row when the count is odd.
              wide={index === choices.length - 1 && choices.length % 2 === 1}
            />
          ))}
        </OptionGrid>
        <Banner tone="info" icon="portfolio" role="none">
          Everything you add counts in one net worth, chart and allocation, in USD, EUR or RUB.
        </Banner>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={chosen === null}
          onClick={() => chosen && onChoose(chosen)}
        >
          Continue
        </Button>
      </ModalFooter>
    </Modal>
  );
}
