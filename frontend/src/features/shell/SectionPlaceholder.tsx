import { Link } from 'react-router-dom';
import { Icon } from './icons';
import { type PlaceholderSection, placeholderSections } from './navigation';
import PageHeader from './PageHeader';
import './shell-page.css';

// Stands in for a section until its own change ships. It makes no requests and
// shows no numbers, so it cannot misstate the owner's data.
export default function SectionPlaceholder({ section }: { section: PlaceholderSection }) {
  const content = placeholderSections[section];
  return (
    <div className="shell-page">
      <PageHeader title={content.title} />
      <section className="shell-card shell-empty" aria-labelledby={`${section}-status`}>
        <span className="shell-empty__ill" aria-hidden="true">
          <Icon name={content.icon} />
        </span>
        <h2 id={`${section}-status`}>This section is not built yet</h2>
        <p>{content.description}</p>
        <p>Meanwhile your data is in the legacy screens.</p>
        <Link className="shell-button" to={content.legacyPath}>
          {content.legacyLabel}
        </Link>
      </section>
    </div>
  );
}
